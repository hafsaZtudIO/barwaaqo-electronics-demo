import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { readFile, writeFile, readdir, mkdir, copyFile, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, relative, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "dist");
if (relative(root, output) !== "dist") throw new Error("Unexpected static output directory.");
await rm(output, { recursive: true, force: true });
await mkdir(join(output, "frontend/build"), { recursive: true });

const migrationDirectory = join(root, "backend/supabase/migrations");
const migrations = await Promise.all((await readdir(migrationDirectory)).sort()
    .map(name => readFile(join(migrationDirectory, name), "utf8")));

function sourceFile(path) {
    const match = ["", ".js", ".jsx", ".mjs"].map(extension => path + extension).find(existsSync);
    if (!match) throw new Error("Could not resolve " + path);
    return match;
}

const frameworkAliases = {
    "next/link": "frontend/platform/link.jsx",
    "next/image": "frontend/platform/image.jsx",
    "next/navigation": "frontend/platform/navigation.jsx",
    "next/cache": "frontend/platform/navigation.jsx",
};

await build({
    entryPoints: { workspace: join(root, "frontend/workspace.jsx") },
    outdir: join(output, "frontend/build"),
    bundle: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    target: "es2022",
    minify: true,
    splitting: true,
    chunkNames: "chunks/[name]-[hash]",
    define: { "process.env.NODE_ENV": '"production"' },
    external: ["node:*", "fs", "path", "url", "module", "worker_threads"],
    plugins: [{
        name: "original-shop-browser-adapter",
        setup(builder) {
            builder.onResolve({ filter: /^next\// }, args => {
                if (!frameworkAliases[args.path]) throw new Error("Unsupported framework import " + args.path);
                return { path: join(root, frameworkAliases[args.path]) };
            });
            builder.onResolve({ filter: /^@\// }, args => ({ path: sourceFile(join(root, args.path.slice(2))) }));
            builder.onResolve({ filter: /^shop-migrations$/ }, () => ({ path: "migrations", namespace: "shop" }));
            builder.onLoad({ filter: /.*/, namespace: "shop" }, () => ({
                contents: "export default " + JSON.stringify(migrations),
                loader: "js",
            }));
        },
    }],
});

const cssPath = join(root, "frontend/workspace-source.css");
const css = await postcss([tailwind({ base: root })]).process(await readFile(cssPath, "utf8"), {
    from: cssPath, to: join(output, "frontend/build/workspace.css"),
});
await writeFile(join(output, "frontend/build/workspace.css"), css.css);

const databaseFiles = dirname(fileURLToPath(import.meta.resolve("@electric-sql/pglite")));
for (const name of ["pglite.wasm", "initdb.wasm", "pglite.data"]) {
    await copyFile(join(databaseFiles, name), join(output, "frontend/build", name));
}
for (const name of ["index.html", "demo.html", "styles.css", "sample.css"]) {
    await copyFile(join(root, "frontend", name), join(output, "frontend", name));
}
await cp(join(root, "frontend/assets"), join(output, "frontend/assets"), { recursive: true });
await cp(join(root, "frontend/public"), join(output, "frontend/public"), { recursive: true });
await copyFile(join(root, "index.html"), join(output, "index.html"));
await copyFile(join(root, ".nojekyll"), join(output, ".nojekyll"));
console.log("Built the original shop workspace and public home page in dist/.");

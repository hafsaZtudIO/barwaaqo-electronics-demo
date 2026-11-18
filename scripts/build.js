import { mkdir, copyFile, cp } from "node:fs/promises";

await mkdir(new URL("../dist/backend/", import.meta.url), { recursive: true });
await cp(new URL("../frontend/", import.meta.url), new URL("../dist/frontend/", import.meta.url), { recursive: true });
for (const name of ["demo-data.js", "demo-store.js"]) {
    await copyFile(new URL("../backend/" + name, import.meta.url), new URL("../dist/backend/" + name, import.meta.url));
}
await copyFile(new URL("../index.html", import.meta.url), new URL("../dist/index.html", import.meta.url));
console.log("Static demo built in dist/");

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const allowed = new Set(["/", "/index.html", "/backend/demo-data.js", "/backend/demo-store.js"]);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml" };
const port = Number(process.env.PORT || 4173);

createServer(async (request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (!["GET", "HEAD"].includes(request.method)) {
        response.writeHead(405, { Allow: "GET, HEAD" }).end();
        return;
    }
    if (!(allowed.has(path) || path.startsWith("/frontend/")) || path.split("/").some(part => part.startsWith("."))) {
        response.writeHead(404).end("Not found");
        return;
    }
    const target = resolve(root, "." + (path === "/" ? "/index.html" : path));
    if (!target.startsWith(root + sep)) {
        response.writeHead(404).end("Not found");
        return;
    }
    try {
        if (!(await stat(target)).isFile()) throw new Error("Not a file");
        const body = await readFile(target);
        response.writeHead(200, { "Content-Type": types[extname(target)] || "application/octet-stream",
            "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" });
        response.end(request.method === "HEAD" ? undefined : body);
    } catch { response.writeHead(404).end("Not found"); }
}).listen(port, "127.0.0.1", () => console.log("Demo available at http://127.0.0.1:" + port));

// Keep the official static host intact; add the local managed-AI API beside it.
import { spawn } from "node:child_process";
import { createServer, request } from "node:http";
import { fileURLToPath } from "node:url";
import { publicAi, memoryAiState } from "../apps/shop/server/public-ai.ts";

const args = process.argv.slice(2);
let port = 8090;
for (let i = 0; i < args.length; i++) {
  if (args[i] !== "--port" || !args[i + 1]) throw new Error("Usage: npm start -- [--port 8090]");
  port = Number(args[++i]);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
const root = fileURLToPath(new URL("../", import.meta.url));
const vendor = spawn(process.execPath, ["vendor/agentify-website/scripts/serve_site.mjs", "site", "--port", "0"], { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
let server, stopping = false;
function stop(code) { if (stopping) return; stopping = true; process.exitCode = code; server?.closeAllConnections(); server?.close(); vendor.kill("SIGTERM"); }
process.on("SIGINT", () => stop(130)); process.on("SIGTERM", () => stop(143));
vendor.on("exit", code => { if (!stopping) stop(code || 1); });
try {
  const upstream = await new Promise((resolve, reject) => {
    let output = "";
    vendor.once("error", reject); vendor.once("exit", () => reject(new Error("Static host stopped")));
    vendor.stdout.on("data", bytes => { output += bytes; const found = output.match(/Open (http:\/\/[^\s]+)/); if (found) resolve(found[1]); });
  });
  const ai = publicAi({ state: memoryAiState() });
  server = createServer(async (req, res) => {
    const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
    if (!hosts.includes(req.headers.host)) { res.writeHead(403); res.end(); return; }
    if (await ai.handle(req, res, hosts.map(host => `http://${host}`))) return;
    const incoming = new URL(req.url, "http://local.invalid");
    if (incoming.origin !== "http://local.invalid") { res.writeHead(400); res.end(); return; }
    const target = new URL(upstream); target.pathname = incoming.pathname; target.search = incoming.search;
    const proxy = request(target, { headers: req.headers, method: req.method }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
    proxy.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    res.once("close", () => proxy.destroy()); req.pipe(proxy);
  });
  server.on("error", error => { console.error(error.message); stop(1); });
  server.listen(port, "127.0.0.1", () => console.log(`Open http://localhost:${port}/`));
} catch (error) { console.error(error.message); stop(1); }

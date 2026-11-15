import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { resolveShop } from "../scripts/resolve-shop.mjs";
import { createShopStore } from "./store.mjs";

async function body(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) {
    const error = new Error("JSONで送信してください"); error.status = 415; throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) { const error = new Error("送信内容が大きすぎます"); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("JSONを読み込めませんでした"); }
}

export function createAdminServer({ root = fileURLToPath(new URL("../", import.meta.url)), production = false, store = createShopStore({ root, production }), resolver = resolveShop } = {}) {
  return createServer(async (req, res) => {
    const send = (status, data) => {
      req.resume();
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data));
    };
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try {
      const port = req.socket.localPort;
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, ...(port === 80 ? ["127.0.0.1", "localhost"] : [])];
      if (!hosts.includes(req.headers.host)) return send(403, { error: "ローカルの管理画面からアクセスしてください" });
      const origin = `http://${req.headers.host}`;
      if (!["GET", "HEAD"].includes(req.method) && req.headers.origin !== origin) return send(403, { error: "管理画面と同じOriginから操作してください" });
      if (req.headers["sec-fetch-site"] === "cross-site") return send(403, { error: "別サイトからはアクセスできません" });
      const url = new URL(req.url, origin);
      if (url.origin !== origin) return send(403, { error: "接続先が不正です" });
      if (req.method === "GET" && url.pathname === "/api/shops") return send(200, await store.get());
      if (req.method === "POST" && url.pathname === "/api/resolve") {
        const input = await body(req);
        const current = await store.get();
        if (input.id !== undefined && !current.shops.some(shop => shop.id === input.id)) throw new Error("編集する店が見つかりません");
        try {
          return send(200, await resolver(input.url, { shops: current.shops, editingId: input.id, networkIndex: input.networkIndex, production }));
        } catch (error) {
          if (input.id) await store.recordError(input.id, error.message);
          throw error;
        }
      }
      if (req.method === "PUT" && url.pathname === "/api/shops") {
        const input = await body(req);
        return send(200, await store.save(Array.isArray(input) ? input : input.shops, input.cache || {}, input.revision));
      }
      const match = url.pathname.match(/^\/api\/shops\/([^/]+)$/);
      if (req.method === "DELETE" && match) return send(200, await store.delete(decodeURIComponent(match[1]), req.headers["if-match"]));
      const assets = { "/": ["index.html", "text/html"], "/index.html": ["index.html", "text/html"], "/admin.js": ["admin.js", "text/javascript"], "/admin.css": ["admin.css", "text/css"] };
      if (["GET", "HEAD"].includes(req.method) && Object.hasOwn(assets, url.pathname)) {
        const [file, type] = assets[url.pathname];
        const data = await readFile(new URL(file, import.meta.url));
        res.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
        return res.end(req.method === "HEAD" ? undefined : data);
      }
      return send(404, { error: "見つかりません" });
    } catch (error) { if (!res.headersSent && !res.destroyed) send(error.status || 400, { error: error.message }); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--production")) throw new Error("Usage: npm run admin -- [--production]");
  const port = Number(process.env.ADMIN_PORT || 8091);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("ADMIN_PORTは1〜65535で指定してください");
  const server = createAdminServer({ production: args.includes("--production") });
  server.on("error", error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, "127.0.0.1", () => console.log(`店舗管理: http://127.0.0.1:${port}/${args.includes("--production") ? " (production)" : ""}`));
}

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createApp } from "../../apps/shop/server/app.ts";
import { origin } from "../../apps/shop/server/auth.ts";
import { Store, type Shop } from "../../apps/shop/server/store.ts";
import { seedRestaurantDemo } from "../../apps/shop/scripts/seed-restaurant-demo.ts";
import { decorateRestaurant, shopDesigns } from "./challenge-theme.ts";

// Recovered from the former challenge demo image. The database and mail sink are isolated from dev accounts.
export async function createChallengeDemo() {
  if (process.env.DEMO_MODE !== "true" || process.env.NODE_ENV === "production") throw new Error("Challenge demo requires isolated DEMO_MODE=true and non-production NODE_ENV");
  for (const value of [process.env.APP_ORIGIN, process.env.AGENT_PARENT_URL]) {
    if (!value || new URL(value).origin !== value) throw new Error("Challenge demo requires explicit app and parent origins");
  }
  const shopOrigin = origin();
  const parentOrigin = new URL(process.env.AGENT_PARENT_URL!).origin;
  const demoArea = "神奈川県横浜市港北区大倉山";
  const store = new Store(":memory:");
  const { shops: restaurants } = await seedRestaurantDemo(store);
  const restaurantSlugs = new Set(restaurants);
  for (const shop of await store.list<Shop>("shop")) {
    if (!shop.published?.seating) throw new Error(`Missing seating configuration for ${shop.slug}`);
    shop.published.address = `${demoArea}（架空のデモ店舗）`;
    shop.published.description += " 予約体験用の架空店舗です。氏名と電話番号はテスト用の値を入力してください。";
    shop.published.seating.confirmationCall = false;
    decorateRestaurant(shop.published, shop.slug as keyof typeof shopDesigns, shopOrigin);
    await store.saveShop(shop);
  }

  const retail = {
    name: "文具と器 こまど",
    area: demoArea,
    hours: "土曜 12:00〜21:00",
    products: ["作家の器", "手帳", "紙雑貨", "贈り物用の文具"],
  };
  const retailBase = "/s/komado";
  const agentBase = `${retailBase}/agent`;
  const photos = new Map(await Promise.all([
    ...[...restaurants, "komado"].map(slug => [`/s/${slug}/demo-photo.webp`, `${slug}.webp`]),
    [`${retailBase}/okurayama.webp`, "okurayama.webp"],
  ].map(async ([path, file]) => [path, await readFile(new URL(`./challenge-assets/${file}`, import.meta.url))] as const)));
  const protocolVersion = "2025-06-18";
  const infoTool = {
    name: "get_shop_info",
    description: "文具と器 こまどの営業時間と取扱品を取得します。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  };

  function json(res: ServerResponse, value: unknown, status = 200) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(value));
  }

  async function retailMcp(req: IncomingMessage, res: ServerResponse) {
    let bytesRead = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        bytesRead += chunk.length;
        if (bytesRead > 8192) { req.resume(); return json(res, { error: "Request too large" }, 413); }
        chunks.push(chunk);
      }
      const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (request?.jsonrpc !== "2.0" || typeof request.method !== "string") throw new Error("Invalid request");
      const reply = (result: unknown) => json(res, { jsonrpc: "2.0", id: request.id, result });
      switch (request.method) {
        case "initialize": return reply({ protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "komado-shop-info", version: "1" } });
        case "notifications/initialized": res.writeHead(202); return res.end();
        case "tools/list": return reply({ tools: [infoTool] });
        case "tools/call":
          if (request.params?.name === infoTool.name) {
            return reply({ structuredContent: retail, content: [{ type: "text", text: JSON.stringify(retail) }] });
          }
      }
      return json(res, { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Method or tool not found" } });
    } catch {
      return json(res, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid JSON-RPC request" } }, 400);
    }
  }

  const retailManifest = {
    brand: retail.name,
    networks: [{ name: "shop_guide", front_man: "shop_front", hocon: "./shop_guide.network.json" }],
    allowed_peers: [shopOrigin],
    peer_policy: { mode: "closed", deny_origins: [] },
  };
  const retailNetwork = {
    tools: [{ name: "shop_front", instructions: "get_shop_infoで確認した営業時間と取扱品を依頼に合わせて案内してください。予約・注文・決済は受け付けません。", tools: [{ url: `${shopOrigin}${agentBase}/mcp`, tools: [infoTool.name] }] }],
  };
  const retailPage = `<!doctype html>
  <html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${retail.name}</title><meta name="description" content="作家の器、手帳、紙雑貨、贈り物用の文具を扱う架空のデモ店舗。">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: clamp(1rem,5vw,4rem) clamp(1rem,5vw,4rem); background:#f6f1e8; color:#233c33; font:1rem/1.7 system-ui, sans-serif; }
    main { max-width:72rem; margin:auto; }
    .cover { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1.28fr); background:#e5e8d9; border-radius:1.3rem; overflow:hidden; }
    .intro { padding:clamp(1.5rem,4.5vw,3.8rem); align-self:center; }
    .genre { color:#526747; font-weight:750; letter-spacing:.09em; }
    h1 { margin:.3em 0 .45em; font:700 clamp(2.1rem,4.7vw,4rem)/1.22 "Yu Mincho","Hiragino Mincho ProN",serif; }
    h1 span { white-space:nowrap; }
    h2 { margin:0 0 .25rem; font-size:1.12rem; }
    p { margin:.2em 0; }
    .demo { margin-top:1.2rem; font-size:.8rem; }
    figure { position:relative; min-height:21rem; margin:0; }
    figure img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
    figcaption { position:absolute; right:.6rem; bottom:.6rem; color:white; background:#28362b; font-size:.7rem; padding:.1rem .45rem; border-radius:.18rem; }
    .info { display:grid; grid-template-columns:minmax(0,.7fr) minmax(0,1.3fr); gap:1.1rem; margin:clamp(1.1rem,3vw,2rem) 0; }
    .info section { padding:clamp(1rem,3vw,1.7rem); background:#fffdf7; border:1px solid #d7ded0; border-radius:1rem; }
    .area { display:grid; grid-template-columns:6rem 1fr; align-items:center; gap:1rem; padding:.6rem; border-block:1px solid #d9dbcd; }
    .area img { display:block; width:6rem; height:3.85rem; object-fit:cover; border-radius:.3rem; }
    @media (max-width:680px) { .cover,.info {grid-template-columns:1fr;} figure {min-height:0;aspect-ratio:16/9;} }
  </style>
  <main><section class="cover"><div class="intro"><p class="genre">大倉山の雑貨店</p><h1><span>文具と器</span> <span>こまど</span></h1>
  <p>毎日使う器と、手に取りたくなる紙もの。</p><p class="demo">架空のデモ店舗 · ${retail.area}</p></div>
  <figure><img src="${retailBase}/demo-photo.webp" alt="作家の器と文具のイメージ"><figcaption>商品のイメージ</figcaption></figure></section>
  <div class="info"><section><h2>営業時間</h2><p>${retail.hours}</p></section><section><h2>取扱品</h2><p>${retail.products.join("、")}</p></section></div>
  <div class="area"><img src="${retailBase}/okurayama.webp" alt=""><strong>大倉山の梅園</strong></div></main></html>`;

  async function serveRetail(req: IncomingMessage, res: ServerResponse, path: string) {
    const method = req.method;
    if ((method === "GET" || method === "HEAD") && (path === retailBase || path === `${retailBase}/`)) {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors ${parentOrigin}; base-uri 'none'`,
      });
      return res.end(method === "HEAD" ? undefined : retailPage);
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (path === `${agentBase}/mcp`) {
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, MCP-Protocol-Version, Mcp-Session-Id");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      if (method === "OPTIONS") { res.writeHead(204); return res.end(); }
      if (method === "POST") return retailMcp(req, res);
    }
    if (method === "GET" || method === "HEAD") {
      if (path === `${agentBase}/agent-manifest.json`) return json(res, retailManifest);
      if (path === `${agentBase}/shop_guide.network.json`) return json(res, retailNetwork);
      if (path === `${agentBase}/links.json`) return json(res, { version: 1, networks: { shop_guide: {} } });
    }
    res.writeHead(404); res.end();
  }

  // Run the real restaurant booking flow with an in-memory database and a mail sink.
  const demoMail = async () => {};
  const server = createApp(store, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, demoMail);
  const [serveRestaurant] = server.listeners("request");
  server.removeListener("request", serveRestaurant as (...args: unknown[]) => void);
  server.removeAllListeners("upgrade");
  server.on("request", (req, res) => {
    const path = (req.url || "").split("?")[0];
    const read = req.method === "GET" || req.method === "HEAD";
    if (read && path === "/healthz") return json(res, { ok: true, shops: [...restaurantSlugs, "komado"] });
    const photo = read ? photos.get(path) : undefined;
    if (photo) {
      res.writeHead(200, { "Content-Type": "image/webp", "Content-Length": photo.byteLength, "Cache-Control": "public, max-age=3600" });
      res.end(req.method === "HEAD" ? undefined : photo);
      return;
    }
    if (path === retailBase || path.startsWith(`${retailBase}/`)) { void serveRetail(req, res, path); return; }
    const page = /^\/s\/([a-z-]+)(?:\/|$)/.exec(path);
    const api = /^\/api\/public\/([a-z-]+)(?:\/(seats|bookings))?$/.exec(path);
    const mcp = page && path.endsWith("/agent/mcp") && (req.method === "POST" || req.method === "OPTIONS");
    const booking = api?.[2] === "bookings" && req.method === "POST";
    if (page && restaurantSlugs.has(page[1]) && (read || mcp) || api && restaurantSlugs.has(api[1]) && (read || booking)) {
      if (booking && req.headers.origin !== shopOrigin) { res.writeHead(403); res.end(); return; }
      serveRestaurant(req, res);
      return;
    }
    res.writeHead(404); res.end();
  });
  server.once("close", () => { void store.close(); });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3010);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid demo port");
  const server = await createChallengeDemo();
  server.listen(port, "0.0.0.0", () => console.log(`Challenge demo stores listening on port ${port}`));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => server.close(() => process.exit(0)));
}

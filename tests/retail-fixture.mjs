import assert from "node:assert/strict";
import { createServer } from "node:http";

export function createRetailFixture(calls) {
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, MCP-Protocol-Version, Mcp-Session-Id");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    const origin = `http://127.0.0.1:${server.address().port}`;
    const json = value => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
    if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
    if (req.url === "/s/zakka/" || req.url === "/s/guide/") {
      const name = req.url.includes("zakka") ? "雑貨の森" : "文具の小箱";
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(`<!doctype html><title>${name}</title><meta name="description" content="暮らしの器と文具、贈り物を扱うお店。"><script type="application/ld+json">${JSON.stringify({ "@type": "Store", name, address: { addressRegion: "東京都", addressLocality: "新宿区" } })}</script>`);
    }
    if (req.url === "/s/guide/agent/agent-manifest.json") return json({ brand: "文具の小箱", networks: [{ name: "shop_guide", front_man: "shop_front", hocon: "./shop_guide.network.json" }], allowed_peers: [origin], peer_policy: { mode: "closed", deny_origins: [] } });
    if (req.url === "/s/guide/agent/shop_guide.network.json") return json({ tools: [{ name: "shop_front", instructions: "Read public product information using list_products. Do not purchase or reserve.", tools: [{ url: `${origin}/s/guide/agent/mcp`, tools: ["get_shop_info", "list_products", "purchase"] }] }] });
    if (req.url === "/s/guide/agent/links.json") return json({ version: 1, networks: { shop_guide: {} } });
    if (req.url === "/s/guide/agent/mcp") {
      let raw = ""; for await (const chunk of req) raw += chunk;
      const rpc = JSON.parse(raw); calls.push(rpc);
      if (rpc.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
      const tools = [
        { name: "get_shop_info", description: "Public shop information", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
        { name: "list_products", description: "Public product categories", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
        { name: "purchase", description: "Place an order", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: false } },
      ];
      if (rpc.method === "initialize") return json({ jsonrpc: "2.0", id: rpc.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "test-store", version: "1" } } });
      if (rpc.method === "tools/list") return json({ jsonrpc: "2.0", id: rpc.id, result: { tools } });
      assert.ok(["get_shop_info", "list_products"].includes(rpc.params.name), "only read operations may be called");
      const info = rpc.params.name === "get_shop_info" ? { shop: "文具の小箱", address: "東京都新宿区", description: "手帳や万年筆、贈り物の文具を扱うお店。" } : { products: ["手帳", "万年筆"], note: "価格や在庫は店舗で確認してください。" };
      return json({ jsonrpc: "2.0", id: rpc.id, result: { structuredContent: info, content: [{ type: "text", text: JSON.stringify(info) }] } });
    }
    res.writeHead(404); res.end();
  });
  return server;
}

import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { readFile } from "node:fs/promises";
import { createChallengeDemo } from "../../../infra/dev/challenge-demo.ts";

test("recovered four-store demo serves pages/photos/current agents and keeps management outside the demo", async t => {
  const previous = { ...process.env };
  Object.assign(process.env, { NODE_ENV: "development", DEMO_MODE: "true", APP_ORIGIN: "https://shop.example", AGENT_PARENT_URL: "https://guide.example" });
  const server = await createChallengeDemo();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); process.env = previous; });
  const port = (server.address() as { port: number }).port;
  const call = (path: string, data?: unknown, origin = "https://shop.example") => new Promise<{ status: number; headers: Record<string, any>; body: Buffer; json: any }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method: data === undefined ? "GET" : "POST", headers: { Host: "shop.example", Origin: origin, "Accept-Language": "ja", ...(data === undefined ? {} : { "Content-Type": "application/json" }) } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", bytes => chunks.push(bytes));
      res.on("end", () => { const body = Buffer.concat(chunks); resolve({ status: res.statusCode!, headers: res.headers, body, json: res.headers["content-type"]?.includes("application/json") ? JSON.parse(body.toString()) : undefined }); });
    });
    req.on("error", reject); req.end(data === undefined ? undefined : JSON.stringify(data));
  });
  assert.deepEqual((await call("/healthz")).json, { ok: true, shops: ["akari", "trattoria-sole", "kanton-ryu", "komado"] });
  const names = { akari: "炉端 灯", "trattoria-sole": "トラットリア ソーレ", "kanton-ryu": "広東 龍", komado: "こまど" };
  for (const [slug, name] of Object.entries(names)) {
    const page = await call(`/s/${slug}/`);
    assert.equal(page.status, 200); assert.ok(page.body.toString().includes(name));
    assert.ok(page.body.toString().includes("架空"));
    const photo = await call(`/s/${slug}/demo-photo.webp`);
    assert.equal(photo.status, 200); assert.equal(photo.headers["content-type"], "image/webp");
    assert.deepEqual(photo.body, await readFile(new URL(`../../../infra/dev/challenge-assets/${slug}.webp`, import.meta.url)));
    const manifest = await call(`/s/${slug}/agent/agent-manifest.json`);
    assert.equal(manifest.status, 200); assert.ok(manifest.json.allowed_peers.includes("https://shop.example"));
    const rpc = (method: string, params?: unknown) => call(`/s/${slug}/agent/mcp`, { jsonrpc: "2.0", id: 1, method, params });
    assert.equal((await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "demo-recovery-test", version: "1" }, capabilities: {} })).status, 200);
    const tools = (await rpc("tools/list")).json.result.tools;
    assert.ok(tools.length > 0); assert.ok(tools.every((tool: any) => tool.annotations?.readOnlyHint === true));
    const info = (await rpc("tools/call", { name: "get_shop_info", arguments: {} })).json;
    assert.ok(JSON.stringify(info).includes(name));
    assert.match(page.body.toString(), /id="assistant-toggle"/);
    assert.match((await call(`/s/${slug}/agent/site.js`)).body.toString(), /voice-bridge/);
    assert.equal((await call(`/s/${slug}/agent/voice-bridge.js`)).status, 200);
    if (slug === "komado") {
      assert.equal(manifest.json.networks[0].name, "shop_guide");
      assert.deepEqual(info.result.structuredContent.products, ["作家の器", "手帳", "紙雑貨", "贈り物用の文具"]);
      assert.equal((await call(`/s/${slug}/agent/shop_guide.network.json`)).status, 200);
    }
    if (slug !== "komado") {
      assert.equal((await call(`/s/${slug}/reserve`)).status, 200);
      assert.match((await call(`/s/${slug}/agent/site.js`)).body.toString(), /voice-bridge/);
      assert.equal((await call(`/s/${slug}/agent/voice-bridge.js`)).status, 200);
      assert.equal((await call(`/s/${slug}/agent/voice-turn.js`)).status, 200);
      const state = (await call(`/api/public/${slug}`)).json;
      assert.equal(state.config.seating.confirmationCall, false);
    }
  }
  for (const path of ["/", "/api/shops", "/api/workspace", "/api/ai/config", "/s/num05/", "/s/akari-other/"]) assert.equal((await call(path)).status, 404, path);
  for (const path of ["/api/demo-login", "/api/ai/session", "/phone/incoming", "/api/shops/anything/plan"]) assert.equal((await call(path, {})).status, 404, path);
  assert.equal((await call("/api/public/akari/bookings", {}, "https://evil.example")).status, 403);
  const unknown = await call("/s/komado/agent/mcp", { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "purchase", arguments: {} } });
  assert.equal(unknown.json.error.code, -32602);
});

test("demo startup refuses accidental production or missing explicit origins", async () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, { DEMO_MODE: "true", NODE_ENV: "production" });
    await assert.rejects(createChallengeDemo(), /isolated/);
    process.env.NODE_ENV = "development"; delete process.env.AGENT_PARENT_URL;
    await assert.rejects(createChallengeDemo(), /explicit/);
  } finally { process.env = previous; }
});

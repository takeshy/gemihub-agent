import test from "node:test";
import assert from "node:assert/strict";
import { createShopTransport, inferArea, messages, normalizeShopUrl, resolveShop } from "../scripts/resolve-shop.mjs";

const origin = "https://shops.example";
const base = `${origin}/s/akari`;
const manifest = { networks: [{ name: "reservation_concierge", front_man: "front", hocon: "./reservation_concierge.network.json" }] };
const network = { tools: [{ name: "front", instructions: "Read shop info.", tools: [{ url: `${base}/agent/mcp`, tools: ["get_shop_info"] }] }] };
const info = { shop: "炉端 灯", address: "〒160-0022 東京都新宿区新宿1-1", description: "炉端のお店", reservePageUrl: `${base}/reserve`, reservation: { partySize: { min: 1, max: 24 }, seatOnlyAllowed: true } };
function fixture({ manifestValue = manifest, networkValue = network, infoValue = info, mcpFails = false, htmlLink = false, declaration, contentOnly = false, sse = false } = {}) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    assert.equal(options.redirect, "manual");
    assert.ok(options.signal);
    if (url === `${base}/agent/agent-manifest.json` && !htmlLink) return Response.json(manifestValue);
    if (url === `${base}/agent/agent-manifest.json` && htmlLink) return new Response("", { status: 404 });
    if (htmlLink && url === `${base}/reserve`) return new Response(`<html><link href='./discovery/agent-manifest.json' rel='alternate agent-manifest'></html>`);
    if (htmlLink && url === `${base}/discovery/agent-manifest.json`) return Response.json(manifestValue);
    if (url.endsWith("reservation_concierge.network.json")) return Response.json(networkValue);
    if (url.endsWith("agent-mcp.json")) return Response.json(declaration || { available: false });
    if (url === `${base}/agent/mcp`) {
      if (mcpFails) throw new Error("offline");
      const rpc = JSON.parse(options.body);
      assert.ok(["initialize", "notifications/initialized", "tools/call"].includes(rpc.method));
      if (rpc.method !== "initialize") assert.equal(options.headers["Mcp-Session-Id"], "test-session");
      if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (rpc.method === "tools/call") assert.deepEqual(rpc.params, { name: "get_shop_info", arguments: {} });
      const result = rpc.method === "initialize" ? { protocolVersion: "2025-06-18" } : contentOnly ? { content: [{ type: "text", text: JSON.stringify(infoValue) }] } : { structuredContent: infoValue };
      const payload = { jsonrpc: "2.0", id: rpc.id, result };
      return sse ? new Response(`data: ${JSON.stringify(payload)}\n\n`, { headers: { "content-type": "text/event-stream", "Mcp-Session-Id": "test-session" } }) : Response.json(payload, { headers: { "Mcp-Session-Id": "test-session" } });
    }
    return new Response("", { status: 404 });
  };
  return { fetch, calls };
}

for (const suffix of ["", "/", "/reserve", "/agent/", "/agent/agent-manifest.json", "/agent/reservation_concierge"]) {
  test(`resolve URL ${suffix || "top"}, with only a read-only MCP call`, async () => {
    const mock = fixture();
    const result = await resolveShop(`${base}${suffix}?key=discarded#secret`, { fetch: mock.fetch });
    assert.deepEqual(result.shop, { id: "akari", name: "炉端 灯", area: "東京都新宿区", address: "〒160-0022 東京都新宿区新宿1-1", cuisine: "", pageUrl: `${base}/reserve`, networkUrl: `${base}/agent/reservation_concierge` });
    assert.equal(result.cache.status, "connected");
    assert.equal(result.cache.reservationSummary, "1〜24名、席のみ可");
    assert.ok(mock.calls.every(call => !call.url.includes("discarded")));
  });
}
test("normalizes credentials, accepts loopback HTTP, rejects production loopbacks and non HTTPS", () => {
  assert.equal(normalizeShopUrl("https://user:password@shops.example/s/akari?x=1#test").href, base);
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    assert.equal(normalizeShopUrl(`http://${host}:3000/`).protocol, "http:");
    assert.throws(() => normalizeShopUrl(`https://${host}/`, { production: true }), { message: messages.url });
  }
  for (const value of ["invalid", "ftp://shops.example", "http://shops.example"]) assert.throws(() => normalizeShopUrl(value), { message: messages.url });
});
test("generates ID from the domain for a root site", async () => {
  const mock = fixture();
  const result = await resolveShop("https://akari.example/reserve", { fetch: (url, opts) => mock.fetch(url.replace("https://akari.example", base), opts) });
  assert.equal(result.shop.id, "akari-example");
});
test("discovers manifest in HTML and resolves relative references against its directory", async () => {
  const mock = fixture({ htmlLink: true });
  const result = await resolveShop(`${base}/reserve`, { fetch: mock.fetch });
  assert.equal(result.shop.networkUrl, `${base}/discovery/reservation_concierge`);
  assert.ok(mock.calls.some(call => call.url === `${base}/discovery/reservation_concierge.network.json`));
});
test("missing manifest and exact network name report their Japanese messages", async () => {
  await assert.rejects(resolveShop(base, { fetch: async () => new Response("", { status: 404 }) }), { message: messages.manifest });
  await assert.rejects(resolveShop(base, fixture({ manifestValue: { networks: [{ name: "reservation_concierge_other" }] } })), { message: messages.network });
});
test("multiple exact names require an explicit choice", async () => {
  const mock = fixture({ manifestValue: { networks: [...manifest.networks, { ...manifest.networks[0], description: "Second" }] } });
  const result = await resolveShop(base, mock);
  assert.equal(result.choices.length, 2);
  assert.equal(mock.calls.length, 1);
  assert.equal((await resolveShop(base, { ...mock, networkIndex: 1 })).shop.name, info.shop);
  await assert.rejects(resolveShop(base, { ...mock, networkIndex: 3 }), { message: messages.network });
});
test("MCP failure leaves a valid network and manual fields editable", async () => {
  const result = await resolveShop(base, fixture({ mcpFails: true }));
  assert.equal(result.warning, messages.mcp);
  assert.equal(result.shop.name, "");
  assert.equal(result.shop.pageUrl, `${base}/reserve`);
  assert.equal(result.cache.status, "needs-review");
});
test("MCP declaration, JSON text content and SSE are supported", async () => {
  const mock = fixture({ networkValue: { tools: [{ name: "front", instructions: "Read shop info.", tools: [] }] }, declaration: { available: true, endpoint: "./mcp" }, contentOnly: true, sse: true });
  const result = await resolveShop(base, mock);
  assert.equal(result.shop.name, info.shop);
  assert.equal(result.cache.status, "connected");
});
test("rejects ID and safeName collisions; editing excludes the original shop", async () => {
  const shop = (await resolveShop(base, fixture())).shop;
  for (const other of [shop, { ...shop, id: "other", networkUrl: `${origin}/s/akari/agent/reservation-concierge` }, { ...shop, networkUrl: `${origin}/s/other/agent/reservation_concierge` }]) {
    await assert.rejects(resolveShop(base, { ...fixture(), shops: [other] }), { message: messages.duplicate });
  }
  const edited = await resolveShop(base, { ...fixture(), shops: [shop], editingId: shop.id });
  assert.equal(edited.shop.id, shop.id);
});
test("invalid networks fail before contacting MCP", async () => {
  const mock = fixture({ networkValue: { tools: [{ name: "front", instructions: "Read", tools: ["missing"] }] } });
  await assert.rejects(resolveShop(base, mock), /ネットワーク定義が不正/);
  assert.equal(mock.calls.length, 2);
});
test("cross-origin network and MCP URLs are never fetched", async () => {
  const externalNetwork = fixture({ manifestValue: { networks: [{ ...manifest.networks[0], hocon: "https://evil.example/network" }] } });
  await assert.rejects(resolveShop(base, externalNetwork), /異なるオリジン/);
  assert.equal(externalNetwork.calls.length, 1);
  const externalMcp = fixture({ networkValue: { tools: [{ name: "front", instructions: "Read", tools: [{ url: "https://evil.example/mcp" }] }] } });
  assert.equal((await resolveShop(base, externalMcp)).warning, messages.mcp);
  assert.ok(externalMcp.calls.every(call => !call.url.includes("evil")));
});
test("transport follows only same-origin redirects and stops loops", async () => {
  const calls = [];
  const request = createShopTransport({ fetch: async url => { calls.push(url); return url.endsWith("first") ? new Response(null, { status: 302, headers: { location: "/second" } }) : Response.json({ ok: true }); } });
  assert.deepEqual((await request(`${origin}/first`)).value, { ok: true });
  assert.equal(calls.length, 2);
  for (const target of ["https://evil.example/", "http://shops.example/"]) {
    const blocked = createShopTransport({ fetch: async () => new Response(null, { status: 302, headers: { location: target } }) });
    await assert.rejects(blocked(origin));
  }
  const loop = createShopTransport({ fetch: async () => new Response(null, { status: 302, headers: { location: "/loop" } }) });
  await assert.rejects(loop(origin), /多すぎ/);
});
test("transport timeouts cover reading response bodies", async () => {
  const request = createShopTransport({ timeout: 15, fetch: async (_url, { signal }) => ({ ok: true, status: 200, json: () => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })) }) });
  await assert.rejects(request(origin), /通信が10秒/);
});
test("infers prefecture and municipality without the street address", () => {
  for (const [address, area] of [["東京都新宿区新宿1", "東京都新宿区"], ["神奈川県横浜市中区1", "神奈川県横浜市"], ["大阪府大阪市北区1", "大阪府大阪市"], ["北海道札幌市中央区", "北海道札幌市"], ["京都府京都市東山区", "京都府京都市"], ["福岡県糟屋郡志免町1", "福岡県糟屋郡志免町"], ["海外の住所", ""]]) assert.equal(inferArea(address), area);
});

test("AI supplies an editable cuisine default using fetched shop facts", async () => {
  const result = await resolveShop(base, { ...fixture(), suggestCuisine: async details => {
    assert.deepEqual(details, { name: info.shop, description: info.description, existingCuisines: [] });
    return "和食・炉端焼き";
  } });
  assert.equal(result.shop.cuisine, "和食・炉端焼き");
  assert.equal(result.cache.status, "connected");
});
test("AI failure leaves the shop connected and allows manual cuisine input", async () => {
  const result = await resolveShop(base, { ...fixture(), suggestCuisine: async () => { throw new Error("AIの設定を確認してください"); } });
  assert.equal(result.shop.cuisine, "");
  assert.equal(result.cache.status, "connected");
  assert.equal(result.warning, "AIの設定を確認してください");
});
test("refresh preserves an operator's cuisine and does not call AI again", async () => {
  const shop = (await resolveShop(base, fixture())).shop;
  shop.cuisine = "手で直したジャンル";
  const result = await resolveShop(base, { ...fixture(), editingId: shop.id, shops: [shop], suggestCuisine: async () => { assert.fail("must preserve the manual genre"); } });
  assert.equal(result.shop.cuisine, shop.cuisine);
});

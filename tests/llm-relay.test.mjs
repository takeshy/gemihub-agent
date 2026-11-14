import assert from "node:assert/strict";
import test from "node:test";
import { LlmRelay, RELAY_LIMITS } from "../site/llm-relay.js";
import { fromShopFrame } from "../site/shop-frame.js";

const key = "fixture-private-api-key";
const shop = { id: "akari", pageUrl: "https://shop.example/reserve" };
function fixture(options = {}) {
  const calls = [], sent = [];
  const relay = new LlmRelay({
    getSetup: () => ({ router: "https://provider.example/v1", model: "chosen", key }),
    newId: () => "session",
    fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response("answer"); },
    ...options,
  });
  relay.open(shop);
  const request = (changes = {}) => ({ session: "session", id: "session:1", path: "chat/completions", body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }), ...changes });
  const send = (type, data) => sent.push({ type, ...data });
  return { relay, calls, sent, request, send };
}
test("the parent chooses the destination and model and forwards only chat fields", async () => {
  const f = fixture();
  const tools = [{ type: "function", function: { name: "check_availability" } }];
  await f.relay.handle(f.request({ body: JSON.stringify({ model: "expensive", messages: [{ role: "user", content: "hi" }], tools, router: "https://attacker.example", stream: false, metadata: { private: true } }) }), f.send);
  assert.equal(f.calls[0].url, "https://provider.example/v1/chat/completions");
  assert.equal(f.calls[0].init.headers.Authorization, `Bearer ${key}`);
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { model: "chosen", messages: [{ role: "user", content: "hi" }], tools, stream: true, tool_choice: "auto" });
  assert.equal(f.sent.filter(m => m.type === "chunk").map(m => m.text).join(""), "answer");
  assert.equal(f.sent.at(-1).type, "end");
});
test("foreign sessions, unsupported operations, byte limits, expired and spent sessions call no provider", async () => {
  let now = 0;
  const f = fixture({ now: () => now, limits: { ...RELAY_LIMITS, maxRequests: 1, maxBodyBytes: 200 } });
  for (const [changes, status] of [[{ session: "old" }, 403], [{ path: "other" }, 404], [{ body: "not json" }, 400], [{ body: JSON.stringify({ messages: [{ role: "user", content: "あ".repeat(100) }] }) }, 413]]) {
    await f.relay.handle(f.request(changes), f.send);
    assert.equal(f.sent.at(-1).status, status);
  }
  assert.equal(f.calls.length, 0);
  await f.relay.handle(f.request(), f.send);
  await f.relay.handle(f.request({ id: "session:2" }), f.send);
  assert.equal(f.sent.at(-1).status, 429);
  assert.equal(f.calls.length, 1);
  f.relay.open(shop);
  now = RELAY_LIMITS.maxMinutes * 60000 + 1;
  await f.relay.handle(f.request(), f.send);
  assert.equal(f.sent.at(-1).status, 429);
  assert.equal(f.calls.length, 1);
});
test("keys are removed even when provider errors split them across chunks; UTF-8 is preserved", async () => {
  const text = `接続エラー: ${key} / ${key}。`;
  const bytes = new TextEncoder().encode(text);
  const f = fixture({ fetchImpl: async () => new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } }), { status: 401 }) });
  await f.relay.handle(f.request(), f.send);
  assert.equal(f.sent[0].status, 401);
  assert.equal(f.sent.filter(m => m.type === "chunk").map(m => m.text).join(""), "接続エラー: [key] / [key]。");
  assert.ok(!JSON.stringify(f.sent).includes(key));
});
test("stopping a session aborts the provider request and refuses reuse", async () => {
  let signal;
  const f = fixture({ fetchImpl: (_url, init) => { signal = init.signal; return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))); } });
  const running = f.relay.handle(f.request(), f.send);
  f.relay.close();
  await running;
  assert.equal(signal.aborted, true);
  assert.equal(f.relay.running.size, 0);
  assert.equal(f.sent.length, 0);
  await f.relay.handle(f.request(), f.send);
  assert.equal(f.sent.at(-1).status, 403);
});
test("duplicate in-flight ids cannot overwrite the controller used to abort a request", async () => {
  const f = fixture({ fetchImpl: (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))) });
  const running = f.relay.handle(f.request(), f.send);
  await f.relay.handle(f.request(), f.send);
  assert.equal(f.sent.at(-1).status, 409);
  assert.equal(f.relay.running.size, 1);
  f.relay.close();
  await running;
});
test("origin and the current iframe window must both match", () => {
  const current = {}, old = {};
  const event = { source: current, origin: "https://shop.example", data: { type: "gemihub:relay-hello" } };
  assert.equal(fromShopFrame(event, current, shop), true);
  assert.equal(fromShopFrame({ ...event, source: old }, current, shop), false);
  assert.equal(fromShopFrame({ ...event, origin: "https://other.example" }, current, shop), false);
});

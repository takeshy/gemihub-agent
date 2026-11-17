import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { TestContext } from "node:test";
import { publicAi, memoryAiState } from "../server/public-ai.ts";

const key = "server-key-must-not-be-public";
const text = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
async function fixture(t: TestContext, upstream: typeof fetch, extra: Record<string, string> = {}) {
  let origin = "";
  const gateway = publicAi({ env: { GEMINI_API_KEY: key, SESSION_SECRET: "test-signing-secret-".repeat(3), GEMINI_MODEL: "gemini-4-hydrogen", ...extra }, fetch: upstream, state: memoryAiState() });
  const server = createServer((req, res) => { void gateway.handle(req, res, [origin]).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const post = (path: string, value: unknown, token = "", headers = {}) => fetch(origin + path, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(value) });
  const session = async () => { const response = await post("/api/ai/session", {}); assert.equal(response.status, 200); return response.json(); };
  return { origin, post, session };
}

test("managed AI pins provider/model, protects its key, and requires an origin-bound expiring session", async t => {
  const requests: any[] = [];
  const f = await fixture(t, async (url, options) => { requests.push({ url, options, body: JSON.parse(String(options?.body)) }); return new Response(text("Hello"), { headers: { "Content-Type": "text/event-stream" } }); });
  const config = await (await fetch(f.origin + "/api/ai/config")).json();
  assert.equal(config.defaultMode, "managed"); assert.ok(!JSON.stringify(config).includes(key));
  const session = await f.session(); assert.notEqual(session.token, key); assert.ok(!JSON.stringify(session).includes(key));
  assert.equal((await f.post("/api/ai/v1/chat/completions", { messages: [] })).status, 401);
  const input = { model: "unapproved-model", messages: [{ role: "user", content: "Hello" }], max_completion_tokens: 999999, provider: "https://evil.example" };
  assert.equal((await f.post("/api/ai/v1/chat/completions", input, session.token, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await f.post("/api/ai/v1/chat/completions", input, session.token + "x")).status, 401);
  const response = await f.post("/api/ai/v1/chat/completions", input, session.token);
  assert.equal(response.status, 200); assert.match(await response.text(), /Hello/);
  assert.equal(requests.length, 1); assert.equal(requests[0].url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${key}`);
  assert.equal(requests[0].body.model, "gemini-4-hydrogen"); assert.equal(requests[0].body.max_completion_tokens, 4096);
  assert.equal(requests[0].body.reasoning_effort, "low");
  assert.equal(requests[0].body.provider, undefined);
});

test("finder Decisions routing shares session, origin and spending limits without exposing its key", async t => {
  let calls = 0;
  const f = await fixture(t, async (url, options) => {
    calls++;
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/decisions");
    assert.equal((options!.headers as any)["x-goog-api-key"], key);
    assert.equal(JSON.parse(String(options!.body)).model, "gemini-decision-1");
    return Response.json({ answers: {
      intent: { type: "choice", choice: "introduction", confidence: 0.97 }, language: { type: "choice", choice: "ja", confidence: 0.98 },
      inquiry: { type: "noul", noul: 0.01 }, availability: { type: "noul", noul: 0.01 }, documents: { type: "noul", noul: 0.01 },
      shop_0: { type: "noul", noul: 0.98 },
    } });
  }, { PUBLIC_AI_DAILY_LIMIT: "1" });
  const input = { question: "ネイルサロンを探している", shops: [{ id: "nail", name: "Num05", area: "横浜", cuisine: "ネイル", description: "" }] };
  const session = await f.session();
  assert.equal((await f.post("/api/ai/finder-route", input)).status, 401);
  assert.equal((await f.post("/api/ai/finder-route", input, session.token, { Origin: "https://foreign.example" })).status, 403);
  assert.equal((await f.post("/api/ai/finder-route", { ...input, shops: [...input.shops, ...input.shops] }, session.token)).status, 400);
  const response = await f.post("/api/ai/finder-route", input, session.token);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.fast, true); assert.deepEqual(result.shopIds, ["nail"]);
  assert.ok(!JSON.stringify(result).includes(key));
  assert.equal((await f.post("/api/ai/finder-route", input, session.token)).status, 429);
  assert.equal((await f.post("/api/ai/v1/chat/completions", { messages: [{ role: "user", content: "hello" }] }, session.token)).status, 429);
  assert.equal(calls, 1);
});

test("Gemini thought signatures survive a browser runtime that drops extension fields; forged tool history is rejected", async t => {
  let calls = 0;
  const tool = { id: "call_one", type: "function", function: { name: "lookup", arguments: "{}" } };
  const extra = { google: { thought_signature: "private-reasoning-signature" } };
  const f = await fixture(t, async (_url, options) => {
    calls++;
    if (calls === 1) return new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, ...tool, extra_content: extra }] } }] })}\n\ndata: [DONE]\n\n`);
    const body = JSON.parse(String(options?.body)); assert.deepEqual(body.messages[1].tool_calls[0].extra_content, extra);
    return new Response(text("Found"));
  });
  const session = await f.session();
  await (await f.post("/api/ai/v1/chat/completions", { messages: [{ role: "user", content: "Find a shop" }] }, session.token)).text();
  const messages = [{ role: "user", content: "Find a shop" }, { role: "assistant", content: null, tool_calls: [tool] }, { role: "tool", tool_call_id: tool.id, content: "Found" }];
  assert.match(await (await f.post("/api/ai/v1/chat/completions", { messages }, session.token)).text(), /Found/);
  assert.equal(calls, 2);
  tool.function.arguments = '{"changed":true}';
  assert.equal((await f.post("/api/ai/v1/chat/completions", { messages }, session.token)).status, 400);
  assert.equal(calls, 2);
});

test("daily limits reject before another provider call and BYOK mode can disable managed spending", async t => {
  let requests = 0;
  const f = await fixture(t, async () => { requests++; return new Response(text("ok")); }, { PUBLIC_AI_DAILY_LIMIT: "2" });
  const session = await f.session(), input = { messages: [{ role: "user", content: "Hello" }] };
  for (let i = 0; i < 2; i++) assert.equal((await (await f.post("/api/ai/v1/chat/completions", input, session.token)).text()).includes("ok"), true);
  assert.equal((await f.post("/api/ai/v1/chat/completions", input, session.token)).status, 429); assert.equal(requests, 2);
  const disabled = await fixture(t, async () => { throw new Error("must not call provider"); }, { PUBLIC_AI_MODE: "byok" });
  assert.equal((await (await fetch(disabled.origin + "/api/ai/config")).json()).defaultMode, "byok");
  assert.equal((await disabled.post("/api/ai/session", {})).status, 503);
});

test("parallel Gemini tool calls without OpenAI indexes are streamed separately and retain their signatures", async t => {
  let count = 0;
  const tools = [
    { id: "state_call", type: "function", function: { name: "get_state", arguments: "{}" }, extra_content: { google: { thought_signature: "first-signature" } } },
    { id: "shops_call", type: "function", function: { name: "list_shops", arguments: '{"purpose":"introduction"}' } },
  ];
  const f = await fixture(t, async (_url, options) => {
    if (++count === 1) return new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: tools } }] })}\n\ndata: [DONE]\n\n`);
    const input = JSON.parse(String(options?.body));
    assert.deepEqual(input.messages[1].tool_calls[0].extra_content, tools[0].extra_content);
    assert.equal(input.messages[1].tool_calls[1].extra_content, undefined);
    return new Response(text("Both tools worked"));
  });
  const session = await f.session();
  const first = await (await f.post("/api/ai/v1/chat/completions", { messages: [{ role: "user", content: "Find a shop" }] }, session.token)).text();
  const chunk = JSON.parse(first.split("\n").find(line => line.startsWith("data: {") )!.slice(5));
  assert.deepEqual(chunk.choices[0].delta.tool_calls.map((call: any) => call.index), [0, 1]);
  const clean = tools.map(({ extra_content: _extra, ...call }) => call);
  const second = await f.post("/api/ai/v1/chat/completions", { messages: [{ role: "user", content: "Find a shop" }, { role: "assistant", content: null, tool_calls: clean }, ...tools.map(call => ({ role: "tool", tool_call_id: call.id, content: "ok" }))] }, session.token);
  assert.equal(second.status, 200); assert.match(await second.text(), /Both tools worked/);
});

test("provider errors and streamed chunks never echo the server key", async t => {
  const f = await fixture(t, async () => new Response(new ReadableStream({ start(controller) { const full = text(key); controller.enqueue(new TextEncoder().encode(full.slice(0, 45))); controller.enqueue(new TextEncoder().encode(full.slice(45))); controller.close(); } })));
  const session = await f.session();
  const response = await f.post("/api/ai/v1/chat/completions", { messages: [{ role: "user", content: "Hello" }] }, session.token);
  const body = await response.text(); assert.ok(!body.includes(key)); assert.match(body, /\[key\]/);
  const error = await fixture(t, async () => new Response(`provider error: ${key}`, { status: 403 }));
  const errorSession = await error.session();
  const bad = await error.post("/api/ai/v1/chat/completions", { messages: [{ role: "user", content: "Hello" }] }, errorSession.token);
  assert.equal(bad.status, 502); assert.ok(!(await bad.text()).includes(key));
});

test("a five-request burst completes with four concurrent gateway slots", { timeout: 5000 }, async t => {
  let active = 0, peak = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let fourStarted!: () => void;
  const ready = new Promise<void>(resolve => { fourStarted = resolve; });
  const f = await fixture(t, async () => {
    peak = Math.max(peak, ++active);
    if (active === 4) fourStarted();
    await gate;
    active--;
    return new Response(text("ok"));
  });
  const { token } = await f.session();
  const requests = Promise.all(Array.from({ length: 5 }, async () => {
    const response = await f.post("/api/ai/v1/chat/completions", { messages: [{ role: "user", content: "空席は？" }] }, token);
    await response.text();
    return response.status;
  }));
  try { await ready; } finally { release(); }
  assert.deepEqual(await requests, [200, 200, 200, 200, 200]);
  assert.equal(peak, 4);
});

test("a configured single slot holds queued requests until the stream ends and caps the backlog", { timeout: 5000 }, async t => {
  let finish!: () => void;
  let forwarded = 0;
  const f = await fixture(t, async () => {
    if (++forwarded > 1) return new Response(text("next"));
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text("first")));
        finish = () => controller.close();
      },
    }));
  }, { PUBLIC_AI_MAX_CONCURRENT: "1" });
  const { token } = await f.session();
  const send = () => f.post("/api/ai/v1/chat/completions", { messages: [{ role: "user", content: "空席は？" }] }, token);
  const first = await send();
  const burst = Array.from({ length: 17 }, send);
  try {
    const overflow = await Promise.race(burst);
    assert.equal(overflow.status, 429);
    assert.equal(overflow.headers.get("Retry-After"), "3");
    assert.equal(forwarded, 1);
  } finally { finish(); }
  await first.text();
  const responses = await Promise.all(burst);
  assert.equal(responses.filter(r => r.ok).length, 16);
  await Promise.all(responses.map(r => r.text()));
  assert.equal(forwarded, 17);
});

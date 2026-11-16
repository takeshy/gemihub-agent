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

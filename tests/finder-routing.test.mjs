import test from "node:test";
import assert from "node:assert/strict";
import { installFinderRouting, routedFinderRequest } from "../site/finder-routing.js";
import { TraceBus } from "../site/runtime/trace.js";

const shops = [
  { id: "nail", name: "Num05", area: "横浜", cuisine: "ネイル", description: "気さくなお店", pageUrl: "https://nail.example/", reservationEnabled: false },
  { id: "food", name: "料理店", area: "横浜", cuisine: "和食", networkTool: "food_agent", reservationEnabled: true },
  { id: "goods", name: "文具店", area: "横浜", cuisine: "文具", networkTool: "goods_agent", reservationEnabled: false },
];
const tools = ["website_show_shop_introductions", "website_get_finder_state", "website_search_chat_documents", "website_confirm_shop_inquiries", "website_set_reservation_conditions", "website_show_candidates", "food_agent", "goods_agent"].map(name => ({ type: "function", function: { name, parameters: {} } }));
const route = (changes = {}) => ({ kind: "introduction", language: "ja", shopIds: ["nail"], shopsCertain: true, needsInquiry: false, needsAvailability: false, needsDocuments: false, fast: true, ...changes });
const request = { messages: [{ role: "system", content: "original full instructions" }, { role: "user", content: "ネイルサロンを探している" }], tools };
function arrange(result, upstream = async value => value) {
  const trace = new TraceBus(), parentSpan = trace.start("agent", { isTopFrontMan: true });
  let decisions = 0, modelCalls = 0;
  const engine = { top: { llm: { chat: async value => { modelCalls++; return upstream(value); } } }, trace, byokKey: "session-not-provider-key" };
  const page = { shops, introductions: [] };
  installFinderRouting(engine, { mode: "managed", config: { finderRouting: true } }, () => page, { fetch: async (_url, options) => {
    decisions++;
    const body = JSON.parse(options.body);
    assert.equal(body.shops.length, 3);
    assert.equal(body.tools, undefined);
    assert.ok(body.messages.every(message => message.role !== "system"));
    return typeof result === "function" ? result(body) : Response.json(result);
  } });
  return { engine, parentSpan, page, counts: () => ({ decisions, modelCalls }), chat: value => engine.top.llm.chat({ ...request, parentSpan, ...value }) };
}

test("simple introductions execute the registered card tool with no generative model calls", async () => {
  const f = arrange(route());
  const first = await f.chat();
  assert.deepEqual(JSON.parse(first.toolCalls[0].function.arguments), { shopIds: ["nail"] });
  const call = first.toolCalls[0];
  const result = await f.chat({ messages: [...request.messages, { role: "assistant", content: "", tool_calls: [call] }, { role: "tool", tool_call_id: call.id, content: JSON.stringify({ status: "succeeded", result: { ok: true } }) }] });
  assert.match(result.content, /紹介カード/);
  assert.deepEqual(result.toolCalls, []);
  assert.deepEqual(f.counts(), { decisions: 1, modelCalls: 0 });
});

test("document questions and inquiries include only relevant prompts, tools and selected shop agents", () => {
  const docs = routedFinderRequest(request, route({ kind: "documents", fast: false, shopIds: [] }), shops);
  assert.deepEqual(docs.tools.map(tool => tool.function.name), ["website_search_chat_documents"]);
  assert.ok(docs.messages[0].content.length < 2000);
  assert.doesNotMatch(docs.messages[0].content, /Num05|food_agent|goods_agent/);
  const details = routedFinderRequest(request, route({ kind: "details", fast: false, needsInquiry: true, shopIds: ["goods"] }), shops);
  assert.ok(details.tools.some(tool => tool.function.name === "goods_agent"));
  assert.ok(!details.tools.some(tool => tool.function.name === "food_agent"));
  assert.match(details.messages[0].content, /approved shops/);
  const mixed = routedFinderRequest(request, route({ kind: "availability", fast: false, needsAvailability: true, needsDocuments: true, shopIds: ["food", "goods"] }), shops);
  assert.ok(mixed.tools.some(tool => tool.function.name === "website_search_chat_documents"));
  assert.ok(mixed.tools.some(tool => tool.function.name === "food_agent"));
  assert.ok(!mixed.tools.some(tool => tool.function.name === "goods_agent"));
});

test("failed and uncertain routing retain the original model request and do not cache across turns", async () => {
  for (const result of [{ kind: "other" }, () => { throw new Error("offline"); }, { ...route(), shopIds: ["invented"] }]) {
    const f = arrange(result);
    const result1 = await f.chat();
    assert.equal(result1.messages[0].content, request.messages[0].content);
    const otherTurn = f.engine.trace.start("agent", { isTopFrontMan: true });
    await f.chat({ parentSpan: otherTurn });
    assert.deepEqual(f.counts(), { decisions: 2, modelCalls: 2 });
  }
});

test("steering reclassifies and never sends unsigned local tool calls to the gateway", async () => {
  let round = 0;
  const f = arrange(() => Response.json(++round === 1 ? route() : { kind: "other" }));
  const first = await f.chat(), call = first.toolCalls[0];
  const next = await f.chat({ messages: [...request.messages, { role: "assistant", tool_calls: [call] }, { role: "tool", tool_call_id: call.id, content: '{"status":"succeeded","result":{"ok":true}}' }, { role: "user", content: "やっぱり図書館を知りたい" }] });
  assert.ok(!next.messages.some(message => message.tool_calls?.some(item => item.id === call.id)));
  assert.ok(!next.messages.some(message => message.role === "tool" && message.tool_call_id === call.id));
  assert.deepEqual(f.counts(), { decisions: 2, modelCalls: 1 });
});

test("BYOK and downstream agents do not send requests to the site's Decisions endpoint", async () => {
  const f = arrange(route());
  const peer = f.engine.trace.start("agent", { isTopFrontMan: false });
  await f.chat({ parentSpan: peer });
  assert.deepEqual(f.counts(), { decisions: 0, modelCalls: 1 });
  const engine = { top: { llm: { chat: async () => "byok" } } };
  const original = engine.top.llm.chat;
  installFinderRouting(engine, { mode: "byok", config: { finderRouting: true } }, () => ({ shops }));
  assert.equal(engine.top.llm.chat, original);
});

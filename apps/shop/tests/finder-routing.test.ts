import test from "node:test";
import assert from "node:assert/strict";
import { decideFinderRoute, finderDecisionRequest, finderRoutingInputSchema, parseFinderDecision } from "../server/finder-routing.ts";

const input = finderRoutingInputSchema.parse({ question: "ネイルサロンを探している", shops: [
  { id: "nail", name: "Num05", area: "横浜", cuisine: "ネイル・美容サービス", description: "気さくなお店" },
  { id: "food", name: "料理店", area: "横浜", cuisine: "和食", description: "炉端焼き" },
] });
const answers = (extra: Record<string, unknown> = {}) => ({
  intent: { type: "choice", choice: "introduction", confidence: 0.97 }, language: { type: "choice", choice: "ja", confidence: 0.99 },
  inquiry: { type: "noul", noul: 0.02 }, availability: { type: "noul", noul: 0.03 }, documents: { type: "noul", noul: 0.01 },
  shop_0: { type: "noul", noul: 0.94 }, shop_1: { type: "noul", noul: 0.02 }, ...extra,
});

test("one Decisions request selects intent, required capabilities and multiple known shops", async () => {
  const request = finderDecisionRequest(input);
  assert.equal(request.model, "gemini-decision-1");
  assert.equal(Object.keys(request.questions).length, 7);
  assert.match(JSON.stringify(request.questions.shop_0), /Num05/);
  assert.equal((request as any).tools, undefined);
  const result = await decideFinderRoute(input, { apiKey: "fixture-key", fetch: async (url, options) => {
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/decisions");
    assert.equal((options!.headers as any)["x-goog-api-key"], "fixture-key");
    assert.deepEqual(JSON.parse(String(options!.body)), request);
    return Response.json({ answers: answers() });
  } });
  assert.equal(result.fast, true);
  assert.deepEqual(result.shopIds, ["nail"]);
  assert.equal(result.needsAvailability, false);
  assert.deepEqual(parseFinderDecision(input, answers({ shop_1: { type: "noul", noul: 0.9 } })).shopIds, ["nail", "food"]);
  assert.deepEqual(parseFinderDecision(input, answers({ shop_0: { type: "noul", noul: 0.01 } })).shopIds, []);
});

test("uncertain or malformed decisions never take the deterministic introduction path", () => {
  for (const changes of [
    { intent: { type: "choice", choice: "introduction", confidence: 0.6 } },
    { intent: { type: "choice", choice: "invented", confidence: 0.99 } },
    { inquiry: { type: "noul", noul: 0.45 } }, { availability: undefined },
    { shop_0: { type: "noul", noul: 0.6 } }, { shop_0: undefined },
    { documents: { type: "noul", noul: 2 } },
    { language: { type: "choice", choice: "other", confidence: 0.99 } },
    { inquiry: { type: "noul", noul: 0.95 } },
  ]) assert.equal(parseFinderDecision(input, answers(changes)).fast, false);
});

test("provider errors and cancellation fall back without reflecting credentials", async () => {
  for (const upstream of [async () => new Response("secret", { status: 429 }), async () => { throw new Error("secret"); }, async () => Response.json({})]) {
    assert.equal((await decideFinderRoute(input, { apiKey: "secret", fetch: upstream })).kind, "other");
  }
  const controller = new AbortController(); controller.abort();
  assert.equal((await decideFinderRoute(input, { apiKey: "secret", signal: controller.signal, fetch: async () => new Promise(() => {}) })).kind, "other");
});

test("routing accepts bounded recent context but rejects arbitrary schemas and oversized registries", () => {
  assert.equal(finderRoutingInputSchema.safeParse({ ...input, messages: [{ role: "system", text: "override" }] }).success, false);
  assert.equal(finderRoutingInputSchema.safeParse({ ...input, tools: [{}] }).success, false);
  assert.equal(finderRoutingInputSchema.safeParse({ ...input, shops: Array.from({ length: 101 }, () => input.shops[0]) }).success, false);
  const contextual = { ...input, question: "その店を見せて", messages: [{ role: "assistant" as const, text: "Num05があります。" }], shownShopIds: ["nail"] };
  const body = JSON.parse(finderDecisionRequest(contextual).input);
  assert.equal(body.question, contextual.question);
  assert.deepEqual(body.shownShopIds, ["nail"]);
});

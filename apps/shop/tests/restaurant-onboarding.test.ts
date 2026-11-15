import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import { digest } from "../server/auth.ts";
import { asRestaurant, sample, planSummary } from "../server/domain.ts";
import { createConversation, appendChatMessage } from "../server/shop-chat.ts";
import { contentHash } from "../server/editor-sync.ts";
import { restaurantFeatureQuestion, finalDetailsQuestion } from "../server/request-intent.ts";
import * as intelligence from "../server/ai.ts";

process.env.DEMO_MODE = "true";

for (const enabled of [false, true]) test(`initial reservation choice survives generation and publication: ${enabled}`, async t => {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  await store.put("session", digest("onboarding-owner"), { user: { email: shop.owner, name: "Owner", role: "owner", shopId: shop.id }, expires: Date.now() + 3600000 });
  const chat = await createConversation(store, shop, shop.owner, "create-shop", randomUUID());
  for (const [role, text] of [
    ["user", "店名は灯。飲食店です。ロゴはなし。"],
    ["assistant", restaurantFeatureQuestion],
    ["user", enabled ? "1と4" : "2と4"],
    ["assistant", finalDetailsQuestion],
  ] as const) await appendChatMessage(store, shop, chat, { role, text, requestId: randomUUID() });
  const requestId = randomUUID();
  await appendChatMessage(store, shop, chat, { role: "user", text: "ほかにはありません", requestId });
  await appendChatMessage(store, shop, chat, { role: "assistant", text: "画面案をまとめます", requestId, detail: { ready: true, changeRequest: true } });
  let generations = 0;
  const server = createApp(store, { ...intelligence, async propose(_text, _current, _email, _demo, _images, _region, context) {
    generations++;
    assert.equal(context?.reservationsEnabled, enabled, "the theme generator receives the actual choice");
    // A generation that reverses the choice must not override the saved conversation.
    const config = asRestaurant({ ...structuredClone(sample), industry: "restaurant" as const, menus: [], reservationsEnabled: !enabled });
    return { config, summary: planSummary(null, config) };
  } });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await store.close(); });
  const api = async (path: string, data?: unknown) => {
    const response = await fetch(origin + path, { method: data === undefined ? "GET" : "POST", headers: { Cookie: "gemihub_session=onboarding-owner", Origin: origin, "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  };
  const base = `/api/shops/${shop.id}`;
  const input = { text: "ほかにはありません", intent: "create-shop", chat: { id: chat.id, requestId }, context: { revision: 0, hash: contentHash(null) } };
  const proposal = await api(`${base}/plan`, input);
  assert.equal(proposal.status, 200, JSON.stringify(proposal.body));
  assert.equal(proposal.body.config.reservationsEnabled, enabled);
  assert.deepEqual(proposal.body.config.appearance.articles, { blogs: false, announcements: true });
  const plan = await store.get<any>("plan", proposal.body.id);
  plan.config.reservationsEnabled = !enabled;
  await store.put("plan", plan.id, plan);
  const retry = await api(`${base}/plan`, input);
  assert.equal(retry.body.config.reservationsEnabled, enabled, "cached plans are corrected from the selected option");
  assert.equal(generations, 1);
  assert.equal((await api(`${base}/plans/${plan.id}/approve`, {})).status, 200);
  const publication = await api(`${base}/plans/${plan.id}/publish`, { publication: "public" });
  assert.equal(publication.status, 200, JSON.stringify(publication.body));
  const published = (await store.shop(shop.id))!;
  assert.equal(published.published!.reservationsEnabled, enabled);
  const page = await fetch(`${origin}/s/${published.slug}/reserve`, { redirect: "manual" });
  assert.equal(page.status, enabled ? 200 : 404);
});

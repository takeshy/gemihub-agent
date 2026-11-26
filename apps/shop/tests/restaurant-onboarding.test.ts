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
import { restaurantFeatureQuestion, otherFeatureQuestion, finalDetailsQuestion } from "../server/request-intent.ts";
import { liveValue } from "../server/live-settings.ts";
import * as intelligence from "../server/ai.ts";

process.env.DEMO_MODE = "true";

for (const [industry, enabled] of [["restaurant", false], ["restaurant", true], ["other", false]] as const) test(`${industry} reservation choice survives generation and publication: ${enabled}`, async t => {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  await store.put("session", digest("onboarding-owner"), { user: { email: shop.owner, name: "Owner", role: "owner", shopId: shop.id }, expires: Date.now() + 3600000 });
  const chat = await createConversation(store, shop, shop.owner, "create-shop", randomUUID());
  for (const [role, text] of [
    ["user", industry === "restaurant" ? "店名は灯。飲食店です。ロゴはなし。" : "店名は灯。文具店です。ロゴはなし。"],
    ["assistant", industry === "restaurant" ? restaurantFeatureQuestion : otherFeatureQuestion],
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
    const config = asRestaurant({ ...structuredClone(sample), industry, menus: [], staff: [], reservationsEnabled: !enabled });
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
  if (industry === "other") {
    const publicPath = `/s/${published.slug}`;
    const home = await fetch(origin + publicPath);
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.doesNotMatch(html, /href="[^"]*\?pane=(?:reserve|mine)/);
    assert.match(html, /href="[^"]*\?pane=contact(?:&amp;lang=[a-z]+)?"/);
    assert.doesNotMatch(html, /#email-login|class="public-auth"/);
    for (const pane of ["reserve", "mine"]) {
      const oldLink = await fetch(`${origin}${publicPath}?pane=${pane}`, { redirect: "manual" });
      assert.equal(oldLink.status, 302);
      assert.equal(oldLink.headers.get("location"), `${publicPath}/`);
    }
    const paymentReturn = await fetch(`${origin}${publicPath}?pane=mine&checkout=test&paypal=return`, { redirect: "manual" });
    assert.equal(paymentReturn.status, 200);
    const menu = sample.menus[0];
    assert.equal((await api(`${base}/live-settings/menus`, { requestId: randomUUID(), value: [menu] })).status, 200);
    const publicApi = `/api/public/${published.slug}`;
    assert.equal((await api(`${publicApi}/slots?menu=${menu.id}`)).status, 409);
    assert.equal((await api(`${publicApi}/bookings`, {})).status, 409);
    const basic = liveValue(published.published!, "basic");
    assert.equal((await api(`${base}/live-settings/basic`, { requestId: randomUUID(), value: { ...basic, reservationsEnabled: true } })).status, 200);
    assert.equal((await api(`${publicApi}/slots?menu=${menu.id}`)).status, 200);
    const enabledHtml = await (await fetch(origin + publicPath)).text();
    assert.match(enabledHtml, /href="[^"]*\?pane=reserve(?:&amp;lang=[a-z]+)?"/);
    assert.match(enabledHtml, /href="[^"]*\?pane=mine(?:&amp;lang=[a-z]+)?"/);
    assert.equal((await api(`${base}/live-settings/basic`, { requestId: randomUUID(), value: basic })).status, 200);
    assert.equal((await api(`${publicApi}/slots?menu=${menu.id}`)).status, 409);
  }
});

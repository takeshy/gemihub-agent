// Optional browser check of a shop opened inside this site, with its assistant's model
// requests relayed here: against the real shop server (gemihub-restaurant started with
// AGENT_PARENT_URL set to this site). The LLM provider's replies are intercepted fixtures:
// no real model request is sent. Reservations are made on the demo server only.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.FINDER_URL || "http://localhost:8090";
const shopOrigin = "http://127.0.0.1:3000";
const KEY = "fixture-only-key";
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, locale: "ja-JP" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const shopRequests = [];
const modelRequests = [];
try {
  await mkdir("test-results", { recursive: true });
  // Everything the browser sends to the shop's origin, service worker traffic included.
  context.on("request", request => { if (request.url().startsWith(shopOrigin)) shopRequests.push({ url: request.url(), headers: request.headers(), body: request.postData() || "" }); });
  let script = [];
  await context.route("https://openrouter.ai/api/v1/chat/completions", async route => {
    const request = route.request();
    const body = request.postDataJSON();
    modelRequests.push({ body, authorization: request.headers().authorization, frame: request.frame().url() });
    const receipts = body.messages.filter(message => message.role === "tool");
    const step = script[receipts.length] || { content: "（fixture: 台本の終わり）" };
    const delta = step.tool ? { tool_calls: [{ index: 0, id: `fixture-${receipts.length}`, type: "function", function: { name: step.tool, arguments: JSON.stringify(typeof step.args === "function" ? step.args(receipts.map(receipt => JSON.parse(receipt.content))) : step.args || {}) } }] }
      : { content: typeof step.content === "function" ? step.content(receipts) : step.content };
    // Two events, so the answer really is streamed through the relay.
    const event = payload => `data: ${JSON.stringify({ model: body.model, choices: [{ index: 0, delta: payload, finish_reason: null }] })}\n\n`;
    const text = delta.content !== undefined ? event({ content: delta.content.slice(0, 5) }) + event({ content: delta.content.slice(5) }) : event(delta);
    await route.fulfill({ contentType: "text/event-stream", headers: { "access-control-allow-origin": "*" }, body: `${text}data: ${JSON.stringify({ model: body.model, choices: [{ index: 0, delta: {}, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n` });
  });
  await context.route("https://openrouter.ai/api/v1/models", route => route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ data: [{ id: "openai/gpt-6-luna" }] }) }));
  const ready = () => page.waitForFunction(() => !!window.__nsweb?.engine);
  const frame = page.frameLocator("#shop-page-frame");
  const sendInShop = async text => {
    const before = modelRequests.length;
    await frame.locator("#ns-input").fill(text);
    await frame.locator("#ns-send").click();
    while (modelRequests.length === before) await page.waitForTimeout(50);
    await frame.locator('.ns-inputbar[data-turn-active="false"]').waitFor();
    return modelRequests.slice(before);
  };

  // An unregistered or malformed shop: an error and the way to the list; nothing opens, nothing is sent.
  for (const bad of ["nobody", "../akari"]) {
    await page.goto(`${base}/?shop=${encodeURIComponent(bad)}`);
    await ready();
    await page.locator("#shop-error").waitFor();
    assert.equal(await page.locator("#shop-bar").isVisible(), false, bad);
    assert.equal(await page.locator("#shop-page-panel").isVisible(), false);
    assert.equal(new URL(page.url()).search, "");
  }
  assert.equal(shopRequests.length, 0);

  // Direct shop visits do not show a link to the finder.
  const direct = await context.newPage();
  await direct.goto(`${shopOrigin}/s/akari/reserve`);
  assert.equal(await direct.locator("#reserve-consult").count(), 0);
  await direct.close();

  // Arriving without an AI setup: the shop opens, its chat does not start, and saving the setup comes back to the same shop.
  await page.goto(`${base}/?shop=akari`);
  await ready();
  await page.locator("#ai-setup-dialog[open]").waitFor();
  await frame.locator("#reserve-form").waitFor();
  await page.waitForFunction(() => /先にこのサイトでAIを設定/.test(document.querySelector("#shop-relay-status").textContent));
  await frame.locator('html[data-relay="denied"]').waitFor();
  assert.equal(await frame.locator("#ns-input").count(), 0, "no chat without a relay");
  assert.equal(await frame.locator("#reserve-date").isEnabled(), true, "the form still works");
  await page.locator("#ai-provider").selectOption("OpenRouter");
  await page.locator("#ns-key").fill(KEY);
  await Promise.all([page.waitForNavigation(), page.locator("#ns-apply").click()]);
  await ready();
  await page.locator("#shop-relay-consent").waitFor();
  assert.equal(await page.locator("#shop-name").textContent(), "炉端 灯", "the same shop after the setup reloads the page");
  assert.match(await page.locator("#shop-relay-question").textContent(), /炉端 灯.*openai\/gpt-6-luna/);
  assert.equal(modelRequests.length, 0);

  // Declined: no chat, and the reason with the manual way on.
  await page.locator("#shop-relay-deny").click();
  await frame.locator('html[data-relay="denied"]').waitFor();
  assert.match(await frame.locator("#assistant-status").textContent(), /許可されなかった/);
  assert.equal(await frame.locator("#ns-input").count(), 0);
  assert.equal(modelRequests.length, 0);

  // Allowed: the shop's own assistant answers in its own page, on the visitor's key, from its own tools.
  await page.locator("#shop-reopen").click();
  await page.locator("#shop-relay-consent").waitFor();
  await page.locator("#shop-relay-allow").click();
  if (await frame.locator("#assistant-toggle").getAttribute("aria-expanded") === "false") await frame.locator("#assistant-toggle").click();
  await frame.locator("#ns-input").waitFor();
  assert.match(await frame.locator("#assistant-status").textContent(), /キーはこのお店には渡されていません/);
  assert.equal(await frame.locator(".ns-settings").isVisible(), false, "no key or provider fields in the shop's page");
  assert.equal(await frame.locator("#reserve-consult").count(), 0, "no link back to the finder in the shop page");
  script = [{ tool: "mcp_get_shop_info" }, { content: receipts => `営業時間は ${JSON.parse(JSON.parse(receipts[0].content).text ?? receipts[0].content).hours?.regular ?? receipts[0].content.match(/\d\d:\d\d . \d\d:\d\d/)?.[0]} です。` }];
  let calls = await sendInShop("営業時間は？");
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.authorization === `Bearer ${KEY}`), "the provider is called with the visitor's key");
  assert.ok(calls.every(call => call.frame.startsWith(base)), "by the finder page, not by the shop's frame or worker");
  assert.ok(calls.every(call => call.body.model === "openai/gpt-6-luna" && call.body.stream === true), "with the model chosen on the finder site");
  assert.ok(calls[0].body.tools.some(tool => tool.function.name === "website_place_reservation") && calls[0].body.tools.some(tool => tool.function.name === "mcp_check_availability"), "the shop's own tools are offered");
  assert.deepEqual(Object.keys(calls[0].body).sort(), ["messages", "model", "stream", "tool_choice", "tools"]);
  assert.match(await frame.locator("#ns-msgs").textContent(), /営業時間は 17:00 – 23:30 です。/, "streamed back into the shop's chat");
  assert.match(await page.locator("#shop-relay-status").textContent(), /2 \/ 40回/);
  await page.screenshot({ path: "test-results/shop-frame-desktop.png", fullPage: true });

  // A reservation proposed by the shop's agent runs only after the visitor confirms it in the shop's page.
  const date = await frame.locator("#reserve-date").getAttribute("max");
  const state = receipts => receipts.map(receipt => receipt.result).findLast(result => result?.version !== undefined);
  script = [
    { tool: "website_fill_reservation_form", args: { date, time: "18:00", partySize: 2 } },
    { tool: "website_get_reservation_page_state" },
    { tool: "website_place_reservation", args: receipts => ({ date, time: "18:00", partySize: 2, name: "中継テスト", phone: "0312345678", expectedVersion: state(receipts).version, expectedTotal: state(receipts).form.total }) },
    { content: receipts => `結果: ${receipts.at(-1).content}` },
  ];
  const reservation = sendInShop("2名で18時、席だけ予約して。名前は中継テスト、電話は0312345678");
  await frame.locator("dialog.assistant-review").waitFor();
  assert.match(await frame.locator("dialog.assistant-review").textContent(), /2名.*席のみ/s);
  assert.equal(shopRequests.filter(request => request.url.endsWith("/api/public/akari/bookings") && request.body).length, 0, "nothing is reserved before the visitor confirms");
  await frame.locator("dialog.assistant-review .assistant-decline").click();
  await reservation;
  assert.match(await frame.locator("#ns-msgs").textContent(), /"status":"cancelled"/);
  assert.equal(await frame.locator("#reserve-result").isVisible(), false);
  const confirmed = sendInShop("やっぱり予約して");
  await frame.locator("dialog.assistant-review").waitFor();
  await frame.locator("dialog.assistant-review .assistant-confirm").click();
  await confirmed;
  await frame.locator("#reserve-result:not([hidden])").waitFor();
  assert.match(await frame.locator("#ns-msgs").textContent(), /"status":"succeeded".*"bookingId"/s);
  assert.equal(shopRequests.filter(request => request.url.endsWith("/api/public/akari/bookings") && request.body).length, 1);
  assert.doesNotMatch(await page.locator("#shop-bar").textContent() + await page.locator("#ns-msgs").textContent(), /ご予約を承りました|予約が完了|予約済み/, "the finder never says a reservation was made");

  // The real key is nowhere on the shop's side: not in a request, its storage, its cookies or its worker's traffic.
  for (const request of shopRequests) {
    assert.ok(!request.url.includes(KEY) && !request.body.includes(KEY) && !JSON.stringify(request.headers).includes(KEY), request.url);
  }
  const bridge = shopRequests.filter(request => request.url.includes("/agent/llm-bridge/v1/chat/completions"));
  assert.ok(bridge.length >= 5 && bridge.every(request => /^Bearer relay-/.test(request.headers.authorization)), "the shop's runtime holds a session label only");
  const shopFrame = page.frames().find(item => item.url().startsWith(shopOrigin));
  const stored = await shopFrame.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]));
  assert.ok(!stored.includes(KEY), "nothing of the key in the shop's storage or cookies");
  assert.ok((await context.cookies(shopOrigin)).every(cookie => !cookie.value.includes(KEY)));

  // Stopped by the visitor: the shop's next request is refused and nothing reaches the provider.
  await page.locator("#shop-relay-stop").click();
  await frame.locator('html[data-relay="closed"]').waitFor();
  assert.match(await page.locator("#shop-relay-status").textContent(), /中継を止めました/);
  const stoppedAt = modelRequests.length;
  await frame.locator("#ns-input").fill("まだ使える？");
  await frame.locator("#ns-send").click();
  await frame.locator('.ns-inputbar[data-turn-active="false"]').waitFor();
  await page.waitForTimeout(500);
  assert.equal(modelRequests.length, stoppedAt, "a closed session calls nothing");
  assert.match(await frame.locator("#ns-msgs").textContent(), /relay/i);
  // A message that claims the old session, or comes from another window, is not served either.
  await shopFrame.evaluate(() => parent.postMessage({ type: "gemihub:llm-request", session: "guessed", id: "guessed:1", path: "chat/completions", body: JSON.stringify({ messages: [{ role: "user", content: "x" }] }) }, "*"));
  await page.evaluate(() => window.postMessage({ type: "gemihub:relay-hello", version: 1, shop: "akari" }, "*"));
  await page.waitForTimeout(500);
  assert.equal(modelRequests.length, stoppedAt);
  assert.equal(await page.locator("#shop-relay-consent").isVisible(), false, "the page itself cannot ask for consent in the shop's name");

  // Switching shops: the first shop's session does not carry over, and the next shop asks again.
  await page.locator("#shop-reopen").click();
  await page.locator("#shop-relay-allow").click();
  if (await frame.locator("#assistant-toggle").getAttribute("aria-expanded") === "false") await frame.locator("#assistant-toggle").click();
  await frame.locator("#ns-input").waitFor();
  const first = await page.evaluate(async () => (await import("./script.js")).App.shopFrame.relay.session.id);
  await page.locator("#shop-list .shop-card").nth(1).locator(".candidate-chat").click();
  await page.locator("#shop-relay-consent").waitFor();
  assert.equal(await page.locator("#shop-name").textContent(), "トラットリア ソーレ");
  assert.equal(await page.evaluate(async () => (await import("./script.js")).App.shopFrame.relay.session), null, "no session until this shop is allowed");
  await page.locator("#shop-relay-allow").click();
  if (await frame.locator("#assistant-toggle").getAttribute("aria-expanded") === "false") await frame.locator("#assistant-toggle").click();
  await frame.locator("#ns-input").waitFor();
  assert.notEqual(await page.evaluate(async () => (await import("./script.js")).App.shopFrame.relay.session.id), first);
  script = [{ content: "ソーレです。" }];
  calls = await sendInShop("こんにちは");
  assert.match(calls[0].body.messages[0].content, /トラットリア ソーレ/, "the second shop's own agent, with none of the first shop's talk");
  assert.doesNotMatch(JSON.stringify(calls[0].body.messages), /炉端 灯|中継テスト/);

  // A narrow screen: the finder's chat and the shop's page take turns.
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.locator("#shop-page-frame").isVisible(), true);
  assert.equal(await frame.locator("#ns-input").isVisible(), true);
  await page.locator("#shop-view-chat").click();
  assert.equal(await page.locator("#shop-page-frame").isVisible(), false);
  assert.equal(await page.locator("#agent-app #ns-input").isVisible(), true);
  await page.screenshot({ path: "test-results/shop-frame-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1200 });

  // Closing the shop keeps the search; a page that cannot be framed is said so, with another tab offered.
  await page.locator("#shop-close").click();
  assert.equal(await page.locator("#shop-page-panel").isVisible(), false);
  assert.equal(new URL(page.url()).search, "");
  await page.route(`${shopOrigin}/s/kanton-ryu/reserve`, route => route.fulfill({ contentType: "text/html", headers: { "x-frame-options": "DENY" }, body: "<!doctype html><title>refused</title>" }));
  await page.locator("#shop-list .shop-card").nth(2).locator(".candidate-chat").click();
  await page.waitForFunction(() => document.querySelector("#shop-page-status").dataset.state === "failed", null, { timeout: 15000 });
  assert.match(await page.locator("#shop-page-status").textContent(), /別タブで開いてください/);
  assert.equal(await page.locator("#shop-relay-consent").isVisible(), false);

  assert.deepEqual(errors, []);
  console.log(`Shop frame check passed: ${modelRequests.length} relayed model calls, ${shopRequests.length} requests to the shop, key never on the shop's side.`);
} finally {
  await browser.close();
}

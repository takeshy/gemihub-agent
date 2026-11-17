// Optional browser check of a shop opened inside this site, with its assistant's model
// requests relayed here: against the real shop server (apps/shop started with
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
page.setDefaultTimeout(15000);
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
    for (let retry = 0; modelRequests.length === before && retry < 200; retry++) await page.waitForTimeout(50);
    assert.ok(modelRequests.length > before, "a model request was relayed");
    await frame.locator('.ns-inputbar[data-turn-active="false"]').waitFor();
    return modelRequests.slice(before);
  };

  // Invalid links do not open or contact a shop.
  for (const id of ["nobody", "../akari"]) {
    await page.goto(`${base}/?shop=${encodeURIComponent(id)}`);
    await ready();
    await page.locator("#shop-error").waitFor();
    assert.equal(await page.locator("#shop-view-header").isVisible(), false);
    assert.equal(await page.locator("#shop-page-panel").isVisible(), false);
  }
  assert.equal(shopRequests.length, 0);
  await page.goto(base);
  await ready();
  await page.locator("#ai-provider").selectOption("OpenRouter");
  await page.locator("#ns-key").fill(KEY);
  await Promise.all([page.waitForNavigation(), page.locator("#ns-apply").click()]);
  await ready();
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const version = await page.evaluate(async date => {
    const { App } = await import("./script.js");
    return App.page.setConditions({ date, time: "18:00", partySize: 2, course: "wanted", avoid: [] }).version;
  }, date);
  script = [
    { tool: "website_show_candidates", args: { expectedVersion: version, candidates: [
      { shopId: "akari", status: "available", remaining: 14, courseId: "winter-robata", courseName: "冬の炉端コース", summary: "2名で予約できます。" },
      { shopId: "trattoria-sole", status: "full", summary: "指定時刻は満席です。" },
    ] } },
    { content: "候補を確認しました。下のカードからお店を選んでください。" },
  ];
  await page.locator("#ns-input").fill("候補を表示して");
  await page.locator("#ns-send").click();
  await page.locator('.ns-inputbar[data-turn-active="false"]').waitFor();
  await page.locator('.finder-results[data-current="true"] .candidate-card').first().waitFor();
  assert.equal(await page.evaluate(() => {
    const messages = [...document.querySelector("#ns-msgs").children];
    return messages.findIndex(item => item.classList.contains("finder-results")) > messages.findIndex(item => item.textContent.includes("候補を確認しました。下のカード"));
  }), true, "the final answer precedes the actionable cards");
  const card = page.locator('.finder-results[data-current="true"] .candidate-card').first();
  assert.equal(await card.locator(".candidate-chat").textContent(), "お店を開く");
  assert.equal(await card.locator(".candidate-button").textContent(), "予約ページへ");
  assert.equal(await card.locator('input[type="checkbox"]').count(), 0);
  const searchCalls = modelRequests.length;
  await card.locator(".candidate-chat").click();
  await frame.locator("#assistant-toggle").waitFor();
  assert.match(page.frames().find(item => item.url().startsWith(shopOrigin)).url(), /\/s\/akari\/(?:[?#]|$)/);
  assert.equal(await page.locator("#agent-app #ns-input").isVisible(), false);
  assert.equal(await page.locator(".hero").isVisible(), false);
  assert.equal(await page.locator("#shop-view-header button").count(), 1);
  assert.equal(await page.locator("#shop-close").textContent(), "← 案内ページに戻る");
  assert.equal(await frame.locator("#ns-input").count(), 0, "the child AI does not boot before Ask the AI");
  assert.equal(modelRequests.length, searchCalls);
  assert.equal(await frame.locator("#reserve-form").isVisible(), false, "the information page has no visible reservation form");
  // Links inside the shop must remain usable inside the same frame.
  await frame.locator(".public-nav").getByRole("link", { name: "ご予約", exact: true }).click();
  await frame.getByRole("button", { name: "AIで予約する", exact: true }).waitFor();
  assert.equal(await frame.locator("#assistant").isVisible(), false);
  assert.equal(await frame.locator("#ns-input").count(), 0);
  assert.match(page.frames().find(item => item.url().startsWith(shopOrigin)).url(), /\/s\/akari\/reserve(?:[?#]|$)/);
  assert.equal(await frame.locator("#reserve-form").isVisible(), true);
  await frame.locator('#root[data-page="static-storefront"]').waitFor();
  await page.waitForFunction(() => document.querySelector("#shop-page-frame").contentWindow !== null);
  await frame.locator(".public-nav").getByRole("link", { name: "お店のこと", exact: true }).click();
  await frame.locator('#root[data-page="static-storefront"]').waitFor();
  const blogs = frame.locator(".public-nav").getByRole("link", { name: "ブログ", exact: true });
  if (await blogs.count()) {
    await blogs.click();
    await frame.locator(".post-archive").waitFor();
    await frame.locator(".public-nav").getByRole("link", { name: "お店のこと", exact: true }).click();
    await frame.locator('#root[data-page="static-storefront"]').waitFor();
  }
  await frame.locator("#assistant-toggle").click();
  await frame.locator("#ns-input").waitFor();
  assert.equal(await page.locator("#shop-relay-consent").count(), 0);
  assert.equal(await frame.locator("#ai-settings-open").isVisible(), false);
  assert.equal(await frame.locator("#assistant-close").textContent(), "元の画面に戻る");
  assert.equal(await frame.locator("#assistant").evaluate(element => element.getBoundingClientRect().left === 0 && element.clientWidth >= document.documentElement.clientWidth - 2), true);
  assert.equal(await frame.locator("#reserve-continue").textContent(), "反映");
  assert.match(await frame.locator("#reserve-carried-text").textContent(), new RegExp(date));
  const beforeApply = modelRequests.length;
  script = [{ content: "予約条件を受け取りました。" }];
  await frame.locator("#reserve-continue").click();
  await frame.locator("#ns-msgs .ns-msg.user").filter({ hasText: date }).waitFor();
  await frame.locator('.ns-inputbar[data-turn-active="false"]').waitFor();
  assert.equal(modelRequests.length, beforeApply + 1);
  assert.ok(modelRequests.at(-1).body.messages.some(message => message.role === "user" && message.content.includes(date) && message.content.includes("18:00")));
  await frame.locator("#assistant-close").click();
  await frame.locator("#assistant-toggle").waitFor();
  assert.equal(await frame.locator("#reserve-form").isVisible(), false, "chat actions do not expose a form on the information page");
  await frame.locator("#assistant-toggle").click();
  await frame.locator("#ns-input").waitFor();
  script = [{ tool: "mcp_get_shop_info" }, { content: "お店の営業時間を確認しました。" }];
  let calls = await sendInShop("営業時間は？");
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.authorization === `Bearer ${KEY}` && call.frame.startsWith(base)));
  assert.match(await frame.locator("#ns-msgs").textContent(), /営業時間を確認/);
  await page.screenshot({ path: "test-results/shop-frame-desktop.png" });
  const firstSession = await page.evaluate(async () => (await import("./script.js")).App.shopFrame.relay.session.id);
  await page.locator("#shop-close").click();
  await card.waitFor();
  assert.equal(await page.evaluate(async () => (await import("./script.js")).App.shopFrame.relay.session), null);
  assert.equal(await page.locator("#shop-page-panel").isVisible(), false);
  await card.locator(".candidate-button").click();
  await frame.getByRole("button", { name: "AIで予約する", exact: true }).waitFor();
  assert.equal(await frame.locator("#assistant").isVisible(), false);
  assert.equal(await frame.locator("#ns-input").count(), 0);
  await frame.locator("#assistant-toggle").click();
  await frame.locator("#ns-input").waitFor();
  assert.equal(await frame.locator("#reserve-form").isVisible(), true);
  assert.equal(await frame.locator(".reserve-shell").count(), 0);
  await frame.locator("#reserve-course").getByRole("option", { name: /冬の炉端/, includeHidden: true }).waitFor({ state: "attached" });
  assert.match(page.frames().find(item => item.url().startsWith(shopOrigin)).url(), /\/s\/akari\/reserve(?:[?#]|$)/);
  assert.equal(await frame.locator("#reserve-course").inputValue(), "winter-robata");
  assert.notEqual(await page.evaluate(async () => (await import("./script.js")).App.shopFrame.relay.session.id), firstSession);
  const state = receipts => receipts.map(receipt => receipt.result).findLast(result => result?.version !== undefined);
  script = [
    { tool: "website_fill_reservation_form", args: { date, time: "18:00", partySize: 2, courseId: "winter-robata" } },
    { tool: "website_get_reservation_page_state" },
    { tool: "website_place_reservation", args: receipts => ({ date, time: "18:00", partySize: 2, courseId: "winter-robata", name: "集中表示テスト", phone: "0312345678", expectedVersion: state(receipts).version, expectedTotal: state(receipts).form.total }) },
    { content: receipts => `結果: ${receipts.at(-1).content}` },
  ];
  const declined = sendInShop("この条件で予約して");
  await frame.locator("dialog.assistant-review").waitFor();
  assert.equal(shopRequests.filter(request => request.url.endsWith("/api/public/akari/bookings") && request.body).length, 0);
  await frame.locator(".assistant-decline").click();
  await declined;
  const confirmed = sendInShop("予約を確定して");
  await frame.locator("dialog.assistant-review").waitFor();
  await frame.locator(".assistant-confirm").click();
  await confirmed;
  await frame.locator("#ns-msgs").filter({ hasText: "結果:" }).waitFor();
  assert.equal(shopRequests.filter(request => request.url.endsWith("/api/public/akari/bookings") && request.body).length, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await frame.locator("#ns-input").isVisible(), true);
  await page.screenshot({ path: "test-results/shop-frame-mobile.png" });
  await page.locator("#shop-close").click();
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.locator("#shop-list .candidate-chat").nth(1).click();
  await frame.locator("#assistant-toggle").click();
  await frame.locator("#ns-input").waitFor();
  script = [{ content: "ソーレです。" }];
  calls = await sendInShop("こんにちは");
  assert.match(calls[0].body.messages[0].content, /トラットリア ソーレ/);
  assert.doesNotMatch(JSON.stringify(calls[0].body.messages), /集中表示テスト|炉端 灯/);
  for (const request of shopRequests) assert.ok(!JSON.stringify(request).includes(KEY), request.url);
  const shopFrame = page.frames().find(item => item.url().startsWith(shopOrigin));
  assert.ok(!(await shopFrame.evaluate(() => JSON.stringify([{ ...localStorage }, { ...sessionStorage }, document.cookie]))).includes(KEY));
  await page.locator("#shop-close").click();
  await page.route(`${shopOrigin}/s/kanton-ryu/`, route => route.fulfill({ contentType: "text/html", headers: { "x-frame-options": "DENY" }, body: "<!doctype html><title>refused</title>" }));
  await page.locator("#shop-list .candidate-chat").nth(2).click();
  await page.waitForFunction(() => document.querySelector("#shop-page-status").dataset.state === "failed", null, { timeout: 15000 });
  assert.equal(await page.locator(".shop-page-links").isVisible(), true);
  // A direct reservation link survives setting up the parent's AI for the first time.
  const fresh = await browser.newContext();
  const setupPage = await fresh.newPage();
  setupPage.on("pageerror", error => errors.push(error.message));
  await fresh.route("https://openrouter.ai/api/v1/models", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ data: [{ id: "openai/gpt-6-luna" }] }) }));
  await setupPage.goto(`${base}/?shop=akari&view=reserve`);
  await setupPage.locator("#ai-setup-dialog[open]").waitFor();
  await setupPage.locator("#ai-provider").selectOption("OpenRouter");
  await setupPage.locator("#ns-key").fill(KEY);
  await Promise.all([setupPage.waitForNavigation(), setupPage.locator("#ns-apply").click()]);
  const freshShop = setupPage.frameLocator("#shop-page-frame");
  await freshShop.getByRole("button", { name: /^(AIで予約する|Reserve with AI)$/ }).waitFor();
  assert.equal(await freshShop.locator("#assistant").isVisible(), false);
  await freshShop.locator("#assistant-toggle").click();
  assert.equal(new URL(setupPage.url()).searchParams.get("view"), "reserve");
  await freshShop.locator("#ns-input").waitFor();
  assert.equal(await setupPage.locator("#shop-relay-consent").count(), 0);
  await fresh.close();
  assert.deepEqual(errors, []);
  console.log(`Shop frame check passed: ${modelRequests.length} relayed model calls, ${shopRequests.length} requests to the shop, key never on the shop's side.`);
} finally {
  await browser.close();
}

// Optional browser integration check. All model and shop responses are intercepted
// test fixtures; this sends no real LLM requests and never books a real table.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.FINDER_URL || "http://localhost:8090";
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const shopRequests = [];
const modelRequests = [];
const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
try {
  await mkdir("test-results", { recursive: true });
  // Routes exist before navigation; any pre-consent contact is recorded too.
  await page.route("http://127.0.0.1:3000/**", async route => {
    const request = route.request();
    shopRequests.push({ url: request.url(), headers: request.headers(), body: request.postData() });
    const url = new URL(request.url());
    const slug = url.pathname.split("/")[2];
    const headers = { "access-control-allow-origin": "*" };
    const json = result => route.fulfill({ contentType: "application/json", headers, body: JSON.stringify(result) });
    if (url.pathname.endsWith("agent-manifest.json")) return json({
      brand: slug, networks: [{ name: "reservation_concierge", front_man: "shop_front", hocon: "./reservation_concierge.network.json" }],
      llm_router: { base_url: "https://must-not-use.invalid/v1", mock: false },
      allowed_peers: [url.origin], peer_policy: { mode: "closed", deny_origins: [] }, deployment: { mode: "static" },
    });
    if (url.pathname.endsWith("reservation_concierge.network.json")) return json({
      llm_config: { model_name: "ignored-peer-model" }, max_steps: 4,
      tools: [{ name: "shop_front", function: { description: `Fixture shop ${slug}`, parameters: { type: "object", properties: { request: { type: "string" } }, required: ["request"] } },
        instructions: `Test fixture ${slug}. Read MCP check_availability, then return the result.`,
        tools: [{ url: `${url.origin}/s/${slug}/agent/mcp`, tools: ["check_availability"] }] }],
    });
    if (url.pathname.endsWith("links.json")) return json({ version: 1, networks: { reservation_concierge: {} } });
    if (url.pathname.endsWith("/mcp")) {
      const rpc = request.postDataJSON();
      if (rpc.method === "notifications/initialized") return route.fulfill({ status: 202, headers });
      const result = rpc.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "test-fixture", version: "1" } }
        : rpc.method === "tools/list" ? { tools: [{ name: "check_availability", description: "Fixture live seats", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] }
          : { content: [{ type: "text", text: JSON.stringify({ status: slug === "akari" ? "available" : "full", remaining: slug === "akari" ? 14 : 2 }) }] };
      return json({ jsonrpc: "2.0", id: rpc.id, result });
    }
    if (url.pathname.endsWith("/reserve")) return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Fixture reservation page</title>" });
    throw new Error(`Unexpected fixture URL ${request.url()}`);
  });
  await page.route("https://openrouter.ai/api/v1/chat/completions", async route => {
    const request = route.request();
    const body = request.postDataJSON(); modelRequests.push({ body, headers: request.headers() });
    assert.equal(request.headers().authorization, "Bearer fixture-only-key");
    const receipts = body.messages.filter(message => message.role === "tool");
    const isFinder = body.tools.some(tool => tool.function.name === "website_set_reservation_conditions");
    const toolCall = (name, args) => ({ tool_calls: [{ index: 0, id: `fixture-${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
    const delta = isFinder
      ? receipts.length === 0 ? toolCall("website_get_finder_state", {})
        : receipts.length === 1 ? toolCall("website_set_reservation_conditions", { date, time: "19:00", partySize: 12, course: "wanted", budgetPerPerson: 5000, avoid: ["えび"], note: "このメモは移動先へ渡さない" })
          : { content: "12名、19:00、コース希望、1人5000円以内、えびを避ける条件を保存しました。" }
      : receipts.length ? { content: "MCPで空席を確認しました。" } : toolCall("mcp_check_availability", {});
    const data = { model: "openai/gpt-6-luna", choices: [{ index: 0, delta, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }] };
    await route.fulfill({ contentType: "text/event-stream", headers: { "access-control-allow-origin": "*" }, body: `data: ${JSON.stringify(data)}\n\ndata: [DONE]\n\n` });
  });
  await page.route("https://openrouter.ai/api/v1/models", route => route.fulfill({
    contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ data: [{ id: "openai/gpt-6-luna" }] }),
  }));
  await page.goto(base);
  await page.waitForFunction(() => { const engine = window.__nsweb?.engine; return engine?.actions.catalog({ base: engine.top.base, network: engine.top.network.name }).length === 7; });
  assert.equal(shopRequests.length, 0);
  assert.equal(modelRequests.length, 0);
  assert.equal(await page.locator("#shop-list .shop-card").count(), 3);
  assert.equal(await page.locator("#conditions-form").count(), 0);
  assert.equal(await page.locator("#comparison").count(), 0);
  assert.equal(await page.locator(".ns-agents").isVisible(), false);
  await page.locator("#ai-setup-dialog[open]").waitFor();
  assert.deepEqual(await page.locator("#ai-provider option").allTextContents(), ["Otari", "Google AI Studio", "Groq", "OpenAI", "Anthropic", "OpenRouter", "その他（接続先を指定）"]);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#ai-setup-dialog").isVisible(), true);
  assert.equal(await page.locator("#ai-setup-close").isVisible(), false);
  await page.screenshot({ path: "test-results/ai-setup-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  const modalBounds = await page.locator("#ai-setup-dialog").boundingBox();
  assert.ok(modalBounds.x >= 0 && modalBounds.x + modalBounds.width <= 390);
  await page.screenshot({ path: "test-results/ai-setup-mobile.png" });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator("#ai-provider").selectOption("Otari");
  assert.equal(await page.locator("#ns-router").inputValue(), "https://api.otari.ai/api/v1");
  assert.equal(await page.locator("#ns-model").inputValue(), "alibaba/qwen3.8-flash");
  await page.locator("#ns-key").fill("otk_fixture-only-not-real");
  await page.locator("#ai-provider").selectOption("OpenAI");
  assert.equal(await page.locator("#ns-key").inputValue(), "");
  assert.equal(await page.locator("#ns-router").inputValue(), "https://api.openai.com/v1");
  await page.locator("#ai-provider").selectOption("custom");
  assert.equal(await page.locator(".ns-settings-advanced").getAttribute("open"), "");
  assert.equal(await page.locator("#ns-router").inputValue(), "");
  await page.locator("#ai-provider").selectOption("OpenRouter");
  assert.equal(shopRequests.length, 0);
  assert.equal(modelRequests.length, 0);
  // Apply a fixture key through the real setup flow, then enter conditions in chat.
  await page.locator("#ns-key").fill("fixture-only-key");
  await page.locator("#ns-apply").click();
  await page.waitForFunction(() => window.__nsweb?.engine?.byokKey === "fixture-only-key");
  assert.equal(await page.locator("#ai-setup-dialog").isVisible(), false);
  assert.doesNotMatch(await page.locator("#ns-msgs .ns-msg.bot").first().textContent(), /ジャンル|場所/);
  await page.locator("#ns-input").fill(`${date} 19時から12名、コース希望、1人5000円以内、えびを避けたい。ジャンルと場所は指定なし。相談用メモ：このメモは移動先へ渡さない`);
  await page.locator("#ns-send").click();
  await page.waitForFunction(() => document.querySelector("#ns-msgs").textContent.includes("条件を保存しました"));
  assert.equal(shopRequests.length, 0);
  const readConditions = () => page.evaluate(async () => (await import("/script.js")).App.page.getState().conditions);
  assert.deepEqual(await readConditions(), { date, time: "19:00", partySize: 12, course: "wanted", budgetPerPerson: 5000, avoid: ["shrimp"], note: "このメモは移動先へ渡さない" });
  // Save and start reloads the page. Conditions collected in chat survive in this tab.
  await page.locator("#ai-settings-open").click();
  await Promise.all([page.waitForEvent("load"), page.locator("#ns-apply").click()]);
  await page.waitForFunction(() => window.__nsweb?.engine);
  assert.equal(await page.locator("#ai-setup-dialog").isVisible(), false);
  // Provider edits are not applied by closing the settings modal.
  await page.locator("#ai-settings-open").click();
  await page.locator("#ai-provider").selectOption("Otari");
  assert.equal(await page.locator("#ns-key").inputValue(), "");
  await page.locator("#ai-setup-close").click();
  await page.waitForFunction(() => document.querySelector("#ns-key").value === "fixture-only-key");
  assert.equal(await page.locator("#ns-key").inputValue(), "fixture-only-key");
  assert.equal(await page.locator("#ns-router").inputValue(), "https://openrouter.ai/api/v1");
  assert.equal((await readConditions()).date, date);
  assert.equal((await readConditions()).partySize, 12);
  assert.deepEqual((await readConditions()).avoid, ["shrimp"]);
  assert.equal(await page.locator("#ns-msgs .candidate-card").count(), 0);
  // Use the real runtime actions and peer dispatch, with one confirmation per search.
  await page.evaluate(async () => {
    const { App } = await import("/script.js");
    const { buildToolTable, dispatchToolCall } = await import("/runtime/runner.js");
    const engine = window.__nsweb.engine;
    const ctx = { network: engine.top.network, manifest: engine.top.manifest, actions: engine.actions, baseOrigin: engine.top.base,
      displayOrigin: location.host, trace: engine.trace, isTop: true, frontMan: "finder_front", slyData: { private_probe: "must-not-reach-shop" },
      requestConsent: info => engine.requestConsent(info), resolveRemote: (ref, chain, parent) => engine.resolveRemote(ref, chain, parent, engine.top.manifest) };
    window.finderTest = { App, engine, ctx, results: [], call: async (name, args) => {
      const table = await buildToolTable(ctx, engine.top.network.getAgentSpec("finder_front"), [], null);
      return dispatchToolCall(ctx, table.toolByName.get(name), args, null, []);
    } };
  });
  const callShop = index => page.evaluate(async index => {
    const { shops } = await import("/shop-registry.js");
    return window.finderTest.call(shops[index].networkTool, { request: "12名、19:00、5000円以内。えびを避けたい。" });
  }, index);
  const beginInquiry = async (cuisine, area) => {
    await page.evaluate(({ cuisine, area }) => {
      const { App, call } = window.finderTest;
      window.finderTest.pending = call("website_confirm_shop_inquiries", { cuisine, area, expectedVersion: App.page.version });
    }, { cuisine, area });
    await page.locator(".finder-inquiry-actions").waitFor();
  };
  const before = shopRequests.length;
  assert.match(await callShop(0), /declined/);
  assert.equal(shopRequests.length, before);
  assert.equal(await page.locator(".ns-consent").count(), 0);
  const noMatches = await page.evaluate(() => {
    const { App, call } = window.finderTest;
    return call("website_confirm_shop_inquiries", { cuisine: "中華", area: "新宿", expectedVersion: App.page.version });
  });
  assert.equal(noMatches.result.count, 0);
  assert.equal(await page.locator(".finder-inquiry-actions").count(), 0);
  await beginInquiry("中華", "横浜");
  assert.match(await page.locator(".finder-inquiry").last().textContent(), /1店のAIで空席・メニューを確認/);
  assert.match(await page.locator(".finder-inquiry").last().textContent(), /広東 龍/);
  assert.doesNotMatch(await page.locator(".finder-inquiry").last().textContent(), /炉端 灯/);
  assert.equal(shopRequests.length, before);
  await page.screenshot({ path: "test-results/inquiry-count-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: "test-results/inquiry-count-mobile.png", fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.getByRole("button", { name: "条件を変える", exact: true }).click();
  assert.equal((await page.evaluate(() => window.finderTest.pending)).result.approved, false);
  assert.match(await callShop(2), /declined/);
  assert.equal(shopRequests.length, before);
  await beginInquiry("中華", "横浜");
  await page.getByRole("button", { name: "確認する", exact: true }).click();
  assert.equal((await page.evaluate(() => window.finderTest.pending)).result.approved, true);
  await assert.rejects(callShop(0), /先に/);
  assert.equal(shopRequests.length, before);
  await callShop(2);
  assert.ok(shopRequests.length > before);
  assert.equal(await page.locator(".ns-consent").count(), 0);
  const afterFiltered = shopRequests.length;
  await page.evaluate(() => {
    const message = document.createElement("div");
    message.className = "ns-msg user";
    message.textContent = "ジャンルも場所も指定なしでお願いします。";
    document.getElementById("ns-msgs").append(message);
  });
  const unrestrictedShops = await page.evaluate(() => window.finderTest.call("website_list_registered_shops", { cuisine: "指定なし", area: "指定なし" }));
  assert.equal(unrestrictedShops.result.length, 3);
  await beginInquiry("指定なし", "指定なし");
  assert.match(await page.locator(".finder-inquiry").last().textContent(), /3店のAIで空席・メニューを確認/);
  assert.equal(shopRequests.length, afterFiltered);
  await page.getByRole("button", { name: "確認する", exact: true }).click();
  await page.evaluate(() => window.finderTest.pending);
  for (const index of [0, 1, 2]) await callShop(index);
  assert.equal(await page.locator(".ns-consent").count(), 0);
  assert.equal(await page.locator(".finder-inquiry-actions").count(), 0);
  assert.ok(modelRequests.length >= 4);
  assert.ok(modelRequests.every(({ body }) => body.model === "openai/gpt-6-luna"));
  for (const request of shopRequests) {
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
    assert.doesNotMatch(JSON.stringify(request), /fixture-only-key|must-not-reach-shop/);
  }
  await page.evaluate(async () => {
    const { App, engine, ctx } = window.finderTest;
    const { buildToolTable, dispatchToolCall } = await import("/runtime/runner.js");
    const table = await buildToolTable(ctx, engine.top.network.getAgentSpec("finder_front"), [], null);
    const receipt = await dispatchToolCall(ctx, table.toolByName.get("website_show_candidates"), { expectedVersion: App.page.version, candidates: [
      { shopId: "akari", status: "available", remaining: 14, durationMinutes: 120, seatOnly: true, courseId: "winter", courseName: "冬の炉端コース", priceText: "1人5,000円 / 12名60,000円", avoidResult: "えび：記載なし。安全の保証ではありません。", summary: "テスト応答：空きあり" },
      { shopId: "trattoria-sole", status: "full", summary: "テスト応答：必要な席数がありません" },
      { shopId: "kanton-ryu", status: "declined", summary: "希望の人数では予約を受け付けていません" },
    ] }, null, []);
    if (receipt.status !== "succeeded" || !receipt.result.ok) throw new Error("Comparison tool did not succeed");
  });
  const currentResults = page.locator('#ns-msgs .finder-results[data-current="true"]');
  assert.equal(await currentResults.locator(".candidate-card").count(), 3);
  assert.match(await currentResults.innerText(), /予約不可/);
  assert.doesNotMatch(await currentResults.innerText(), /問い合わせを拒否|確認見送り/);
  assert.equal(await page.locator(".candidate-card").count(), 3);
  assert.equal(await currentResults.locator("h3").first().textContent(), "炉端 灯");
  await currentResults.locator(".candidate-button").first().click();
  await page.locator("dialog.assistant-review").waitFor();
  assert.match(await page.locator("dialog.assistant-review").textContent(), /名前や連絡先は渡しません/);
  assert.doesNotMatch(await page.locator("dialog.assistant-review").textContent(), /このメモは移動先へ渡さない/);
  await page.getByRole("button", { name: "このページに戻る", exact: true }).click();
  assert.equal(new URL(page.url()).origin, base);
  await currentResults.locator(".candidate-button").first().click();
  await page.locator("dialog.assistant-review[open]").waitFor();
  // A background condition change while review is open invalidates the proposal.
  await page.evaluate(() => { const { App } = window.finderTest; App.page.setConditions({ ...App.page.conditions, partySize: 2 }); });
  await page.getByRole("button", { name: "条件を引き継いで移動", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".finder-results-status").textContent.includes("条件が変わりました"));
  assert.equal(await currentResults.count(), 0);
  assert.equal(await page.locator(".candidate-button:enabled").count(), 0);
  assert.equal(new URL(page.url()).origin, base);
  await page.evaluate(() => {
    const { App } = window.finderTest;
    App.page.setConditions({ ...App.page.conditions, course: "none" });
    App.page.showCandidates({ expectedVersion: App.page.version, candidates: [{ shopId: "akari", status: "available", seatOnly: true, courseName: "表示しないコース", priceText: "表示しない価格", summary: "席のみ空きあり" }] });
  });
  assert.equal(await currentResults.count(), 1);
  assert.doesNotMatch(await currentResults.textContent(), /表示しない/);
  assert.equal(await page.locator('.finder-results[data-current="false"] .candidate-button:enabled').count(), 0);
  // Clearing the conversation also removes its comparisons; no separate panel remains.
  assert.equal(await page.locator("#ns-newchat").isVisible(), false);
  await page.locator(".assistant-chat-menu > summary").click();
  await page.locator("#ns-newchat").click();
  assert.equal(await page.locator(".finder-results").count(), 0);
  assert.equal(await page.evaluate(() => window.finderTest.App.page.candidates.length), 0);
  await page.evaluate(() => {
    const { App } = window.finderTest;
    App.page.showCandidates({ expectedVersion: App.page.version, candidates: [{ shopId: "akari", status: "available", remaining: 14, seatOnly: true, summary: "席のみ空きあり" }] });
  });
  await page.screenshot({ path: "test-results/finder-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "mobile horizontal overflow");
  await page.screenshot({ path: "test-results/finder-mobile.png", fullPage: true });
  // A larger registry still shows the total and approves only the current four.
  const requestsBeforeBatches = shopRequests.length;
  await page.evaluate(async date => {
    const { FinderPage } = await import("/finder.js");
    const { ShopInquiries, reviewShopInquiries } = await import("/inquiries.js");
    const registry = Array.from({ length: 14 }, (_, i) => ({ ...window.finderTest.App.page.shops[i % 3], id: `batch-${i}`, name: `登録店${i + 1}` }));
    const finder = new FinderPage(registry);
    finder.setConditions({ date, time: "19:00", partySize: 2 });
    const inquiries = new ShopInquiries(() => finder, reviewShopInquiries);
    window.batchTest = { finder, inquiries, pending: inquiries.confirm({ cuisine: "", area: "", expectedVersion: finder.version }) };
  }, date);
  assert.match(await page.locator(".finder-inquiry").last().textContent(), /候補は14店です。まず4店/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole("button", { name: "確認する", exact: true }).click();
  assert.equal((await page.evaluate(() => window.batchTest.pending)).nextOffset, 4);
  await page.evaluate(() => {
    const { finder, inquiries } = window.batchTest;
    window.batchTest.pending = inquiries.confirm({ cuisine: "", area: "", expectedVersion: finder.version, offset: 4 });
  });
  assert.match(await page.locator(".finder-inquiry").last().textContent(), /候補は14店です。続きの4店/);
  await page.getByRole("button", { name: "確認する", exact: true }).click();
  const nextBatch = await page.evaluate(() => window.batchTest.pending);
  assert.deepEqual(nextBatch.shops.map(shop => shop.id), ["batch-4", "batch-5", "batch-6", "batch-7"]);
  assert.equal(shopRequests.length, requestsBeforeBatches);
  await currentResults.locator(".candidate-button").first().click();
  await page.getByRole("button", { name: "条件を引き継いで移動", exact: true }).click();
  await page.waitForURL("http://127.0.0.1:3000/s/akari/reserve#**");
  const hash = new URLSearchParams(new URL(page.url()).hash.slice(1));
  assert.equal(hash.get("course"), "none");
  assert.equal(hash.get("people"), "2");
  assert.equal(hash.has("note"), false);
  assert.deepEqual(errors, []);
  console.log(`Browser checks passed: provider modal, switching/secret isolation, saved setup, chat-only conditions/comparisons, stale cards, new chat, desktop/mobile, one confirmation per search, caller router, MCP and handoff. ${shopRequests.length} fixture requests.`);
} finally { await context.close(); await browser.close(); }

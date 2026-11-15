// Uses a real restaurant demo server. Only LLM responses are scripted; no paid model is called.
// All registry changes and builds happen in a disposable copy, never in the working site's files.
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createAdminServer } from "../admin/server.mjs";
import { createRetailFixture } from "./retail-fixture.mjs";
import { GEMINI_DECISIONS_URL, suggestCuisine } from "../scripts/suggest-cuisine.mjs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), "gemihub-admin-browser-"));
const shopOrigin = process.env.SHOP_ORIGIN || "http://127.0.0.1:3000";
const parentPort = Number(process.env.FINDER_PORT || 18090);
const parentUrl = `http://localhost:${parentPort}`;
let admin, parent, browser, cuisineAI, shopWebsite;
const errors = [];
const cuisineCalls = [];
const guideCalls = [];
try {
  await cp(join(root, "site"), join(scratch, "site"), { recursive: true });
  await cp(join(root, "src"), join(scratch, "src"), { recursive: true });
  await symlink(join(root, "vendor"), join(scratch, "vendor"), "dir");
  await writeFile(join(scratch, "site/shops.json"), JSON.stringify({ version: 1, shops: [] }));
  cuisineAI = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const facts = JSON.parse(body.input);
    cuisineCalls.push(facts);
    assert.equal(req.headers["x-goog-api-key"], "fixture-cuisine-key");
    assert.equal(req.url, "/v1beta/decisions");
    assert.equal(body.model, "gemini-decision-1");
    assert.equal(body.questions.cuisine.type, "choice");
    assert.equal(body.tools, undefined);
    const choice = { "炉端 灯": "robata", "トラットリア ソーレ": "italian", "広東 龍": "cantonese", "雑貨の森": "general_goods", "文具の小箱": "stationery" }[facts.name];
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ answers: { cuisine: { type: "choice", choice, confidence: 0.95 } } }));
  });
  await new Promise((accept, reject) => { cuisineAI.once("error", reject); cuisineAI.listen(0, "127.0.0.1", accept); });
  shopWebsite = createRetailFixture(guideCalls);
  await new Promise((accept, reject) => { shopWebsite.once("error", reject); shopWebsite.listen(0, "127.0.0.1", accept); });
  const retailOrigin = `http://127.0.0.1:${shopWebsite.address().port}`;
  admin = createAdminServer({ root: scratch, geminiApiKey: "fixture-cuisine-key", cuisineSuggester: (details, config) => suggestCuisine(details, { ...config, fetch: async (url, options) => {
    assert.equal(url, GEMINI_DECISIONS_URL);
    return fetch(`http://127.0.0.1:${cuisineAI.address().port}/v1beta/decisions`, options);
  } }) });
  await new Promise((accept, reject) => { admin.once("error", reject); admin.listen(0, "127.0.0.1", accept); });
  const adminUrl = `http://127.0.0.1:${admin.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: "ja-JP" });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(adminUrl);
  await page.getByText("登録店はありません。", { exact: false }).waitFor();
  assert.equal(await page.locator("#ai-settings").count(), 0);
  const definitions = [
    ["akari", "炉端 灯", "東京都新宿区", "和食・炉端焼き", ""],
    ["trattoria-sole", "トラットリア ソーレ", "東京都渋谷区", "イタリアン・イタリア料理", "/reserve"],
    ["kanton-ryu", "広東 龍", "神奈川県横浜市", "中華・広東料理", "/agent/agent-manifest.json"],
  ];
  async function saveEditor() {
    const response = page.waitForResponse(response => response.url() === `${adminUrl}/api/shops` && response.request().method() === "PUT");
    await page.getByRole("button", { name: "保存", exact: true }).click();
    assert.equal((await response).status(), 200);
    await page.locator("#editor").waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.body.getAttribute("aria-busy") === "false");
  }
  async function addShop([id, name, area, cuisine, suffix], origin = shopOrigin, reservable = true) {
    const before = await readFile(join(scratch, "site/shops.json"), "utf8");
    await page.getByRole("button", { name: "＋ 店を追加", exact: true }).click();
    await page.locator("#source-url").fill(`${origin}/s/${id}${suffix}`);
    const resolved = page.waitForResponse(response => response.url() === `${adminUrl}/api/resolve`);
    await page.getByRole("button", { name: "読み込む", exact: true }).click();
    const response = await resolved;
    assert.equal(response.status(), 200, await response.text());
    await page.locator("#shop-form").waitFor();
    assert.equal(await page.locator('[name="id"]').inputValue(), id);
    assert.equal(await page.locator('[name="name"]').inputValue(), name);
    assert.equal(await page.locator('[name="area"]').inputValue(), area);
    assert.equal(await page.locator('[name="cuisine"]').inputValue(), cuisine);
    assert.equal(await page.locator('[name="reservationEnabled"]').isChecked(), reservable);
    assert.equal(await readFile(join(scratch, "site/shops.json"), "utf8"), before, "import must not save without the save button");
    await page.locator('[name="cuisine"]').fill(cuisine);
    await saveEditor();
  }
  for (const definition of definitions) await addShop(definition);
  assert.equal(await page.locator("#shops tr").count(), 3);
  assert.equal(await page.getByText("接続OK", { exact: true }).count(), 3);
  assert.match(await page.locator("#message").innerText(), /保存しました/);
  assert.doesNotMatch(await page.locator("#message").innerText(), /作り直したファイル|site\//);
  // Editing keeps IDs fixed; refreshed data is selected explicitly rather than overwriting a draft.
  await page.locator("#shops tr").first().getByRole("button", { name: "編集", exact: true }).click();
  assert.equal(await page.locator("#source-url").inputValue(), `${shopOrigin}/s/akari/`);
  assert.equal(await page.locator('[name="id"]').getAttribute("readonly"), "");
  await page.locator('[name="name"]').fill("仮の店名");
  await page.locator('[name="cuisine"]').fill("手で直したジャンル");
  await saveEditor();
  await page.locator("#shops tr").first().getByRole("button", { name: "再読込", exact: true }).click();
  await page.locator("#differences").waitFor();
  assert.equal(await page.locator("#source-url").inputValue(), `${shopOrigin}/s/akari/`);
  assert.equal(await page.locator('[name="name"]').inputValue(), "仮の店名");
  assert.equal(await page.locator('[name="cuisine"]').inputValue(), "手で直したジャンル");
  assert.equal(cuisineCalls.length, 3, "refresh must preserve manual genres without another AI call");
  assert.equal(await page.locator('#diff-fields input[value="name"]').isChecked(), false);
  await page.locator('#diff-fields input[value="name"]').check();
  await page.getByRole("button", { name: "選んだ項目を反映", exact: true }).click();
  assert.equal(await page.locator('[name="name"]').inputValue(), "炉端 灯");
  await saveEditor();
  await page.getByRole("button", { name: "広東 龍を上へ", exact: true }).click();
  await page.waitForFunction(() => document.body.getAttribute("aria-busy") === "false");
  assert.match(await page.locator("#shops tr").nth(1).innerText(), /広東 龍/);
  await page.getByRole("button", { name: "広東 龍を下へ", exact: true }).click();
  await page.waitForFunction(() => document.body.getAttribute("aria-busy") === "false");
  page.once("dialog", dialog => { assert.match(dialog.message(), /広東 龍/); return dialog.dismiss(); });
  await page.locator("#shops tr").last().getByRole("button", { name: "削除", exact: true }).click();
  assert.equal(await page.locator("#shops tr").count(), 3);
  page.once("dialog", dialog => dialog.accept());
  await page.locator("#shops tr").last().getByRole("button", { name: "削除", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("#shops tr").length === 2 && document.body.getAttribute("aria-busy") === "false");
  await addShop(definitions[2]);
  await addShop(["zakka", "雑貨の森", "東京都新宿区", "雑貨・生活雑貨", "/"], retailOrigin, false);
  await addShop(["guide", "文具の小箱", "東京都新宿区", "文具・紙もの", "/"], retailOrigin, false);
  assert.match(await page.locator("#shops tr").filter({ hasText: "雑貨の森" }).innerText(), /情報取得済み/);
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/admin-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole("button", { name: "＋ 店を追加", exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: "test-results/admin-mobile.png", fullPage: true });
  const config = JSON.parse(await readFile(join(scratch, "site/shops.json")));
  assert.deepEqual(config.shops.map(shop => shop.id), [...definitions.map(([id]) => id), "zakka", "guide"]);
  assert.equal(config.shops[0].cuisine, "手で直したジャンル");
  assert.equal(cuisineCalls.length, 6);
  assert.equal(config.shops.find(shop => shop.id === "zakka").networkUrl, "");
  assert.equal(config.shops.find(shop => shop.id === "guide").reservationEnabled, false);
  // The generated parent really loads each restaurant network and invokes its read-only MCP.
  parent = spawn(process.execPath, [join(root, "vendor/agentify-website/scripts/serve_site.mjs"), join(scratch, "site"), "--port", String(parentPort), "--open-as", "localhost"], { stdio: "pipe" });
  let parentLog = "";
  parent.stdout.on("data", chunk => { parentLog += chunk; }); parent.stderr.on("data", chunk => { parentLog += chunk; });
  await new Promise((accept, reject) => {
    const deadline = setTimeout(() => { clearInterval(poll); reject(new Error(`Parent startup timed out: ${parentLog}`)); }, 10000);
    const poll = setInterval(() => { if (parentLog.includes("http://")) { clearInterval(poll); clearTimeout(deadline); accept(); } }, 50);
    parent.once("error", error => { clearInterval(poll); clearTimeout(deadline); reject(error); });
  });
  const parentPage = await context.newPage();
  parentPage.on("pageerror", error => errors.push(error.message));
  const shopCalls = [];
  parentPage.on("request", request => { if (request.url().startsWith(shopOrigin)) shopCalls.push({ url: request.url(), body: request.postData() }); });
  const date = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  let steps = [
    ["website_set_reservation_conditions", { date, time: "19:00", partySize: 2, course: "none" }],
    ["website_confirm_shop_inquiries", { cuisine: "指定なし", area: "指定なし", expectedVersion: 1 }],
    ...definitions.map(([id]) => [`s_${id.replaceAll("-", "_")}_agent_reservation_concierge`, { request: "店名と住所をget_shop_infoで確認してください。" }]),
  ];
  let finalText = "3店の基本情報を確認しました。";
  await parentPage.route("https://openrouter.ai/api/v1/chat/completions", async route => {
    const body = route.request().postDataJSON();
    const receipts = body.messages.filter(message => message.role === "tool");
    const isFinder = body.tools.some(tool => tool.function.name === "website_set_reservation_conditions");
    const hasProducts = body.tools.some(tool => tool.function.name === "mcp_list_products");
    if (hasProducts) assert.ok(!body.tools.some(tool => tool.function.name === "mcp_purchase"));
    const step = isFinder ? steps[receipts.length] : receipts.length ? undefined : [hasProducts ? "mcp_list_products" : "mcp_get_shop_info", {}];
    const delta = step ? { tool_calls: [{ index: 0, id: `test-${receipts.length}`, type: "function", function: { name: step[0], arguments: JSON.stringify(step[1]) } }] } : { content: isFinder ? finalText : "店のMCPから基本情報を取得しました。" };
    await route.fulfill({ contentType: "text/event-stream", headers: { "access-control-allow-origin": "*" }, body: `data: ${JSON.stringify({ model: body.model, choices: [{ index: 0, delta, finish_reason: step ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n` });
  });
  await parentPage.route("https://openrouter.ai/api/v1/models", route => route.fulfill({ json: { data: [{ id: "openai/gpt-6-luna" }] }, headers: { "access-control-allow-origin": "*" } }));
  await parentPage.goto(parentUrl);
  await parentPage.locator("#ai-provider").selectOption("OpenRouter");
  await parentPage.locator("#ns-key").fill("fixture-only-key");
  await parentPage.locator("#ns-apply").click();
  await parentPage.waitForFunction(() => window.__nsweb?.engine?.byokKey === "fixture-only-key");
  assert.equal(shopCalls.length, 0);
  await parentPage.locator("#ns-input").fill("3店の店名と住所を確認してください。ジャンルも場所も指定なし。");
  await parentPage.locator("#ns-send").click();
  await parentPage.getByRole("button", { name: "確認する", exact: true }).click();
  await parentPage.waitForFunction(() => document.querySelector("#ns-msgs").textContent.includes("3店の基本情報を確認しました。"), { timeout: 30000 });
  for (const [id] of definitions) {
    assert.ok(shopCalls.some(call => call.url === `${shopOrigin}/s/${id}/agent/agent-manifest.json`), `loaded real ${id} manifest`);
    assert.ok(shopCalls.some(call => call.url === `${shopOrigin}/s/${id}/agent/mcp` && call.body && JSON.parse(call.body).params?.name === "get_shop_info"), `called real ${id} get_shop_info`);
  }
  await parentPage.screenshot({ path: "test-results/admin-parent-inquiry.png", fullPage: true });
  const resetChat = async () => {
    await parentPage.locator(".assistant-chat-menu > summary").click();
    await parentPage.locator("#ns-newchat").click();
  };
  await resetChat();
  await parentPage.evaluate(async () => { const { App } = await import("/script.js"); App.page.editConditions({ date: "", time: "", partySize: 2, course: "any", avoid: [], note: "" }); });
  steps = [["website_list_registered_shops", { cuisine: "雑貨" }], ["website_show_shop_introductions", { shopIds: ["zakka"] }]];
  finalText = "雑貨のお店はこちらです。詳しくは店舗サイトをご覧ください。";
  const contactsBeforeIntroduction = shopCalls.length;
  await parentPage.locator("#ns-input").fill("新宿の雑貨店を紹介して");
  await parentPage.locator("#ns-send").click();
  await parentPage.locator(".finder-introductions .shop-introduction").waitFor();
  const introduction = parentPage.locator(".finder-introductions .shop-introduction");
  assert.match(await introduction.innerText(), /雑貨の森/);
  assert.equal(await introduction.locator(".candidate-button").count(), 0);
  assert.equal(await introduction.locator("a").getAttribute("href"), `${retailOrigin}/s/zakka/`);
  assert.equal(shopCalls.length, contactsBeforeIntroduction);
  assert.equal(await parentPage.evaluate(async () => (await import("/script.js")).App.page.getState().valid), false);
  await parentPage.screenshot({ path: "test-results/shop-introduction-desktop.png", fullPage: true });
  await parentPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(await parentPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await parentPage.screenshot({ path: "test-results/shop-introduction-mobile.png", fullPage: true });
  await parentPage.setViewportSize({ width: 1440, height: 1100 });
  await resetChat();
  const version = await parentPage.evaluate(async () => (await import("/script.js")).App.page.version);
  steps = [
    ["website_list_registered_shops", { cuisine: "文具" }],
    ["website_confirm_shop_inquiries", { cuisine: "文具", area: "", purpose: "introduction", query: "どんな文具を扱っていますか？", expectedVersion: version }],
    ["s_guide_agent_shop_guide", { request: "どんな文具を扱っていますか？" }],
    ["website_show_shop_introductions", { shopIds: ["guide"] }],
  ];
  finalText = "文具のお店の公開情報を確認しました。";
  await parentPage.locator("#ns-input").fill("文具のお店のAIに扱っている商品を確認して");
  await parentPage.locator("#ns-send").click();
  await parentPage.getByRole("button", { name: "確認する", exact: true }).waitFor();
  assert.match(await parentPage.locator(".finder-inquiry").last().innerText(), /商品・店舗情報/);
  assert.doesNotMatch(await parentPage.locator(".finder-inquiry").last().innerText(), /人数|空席/);
  await parentPage.getByRole("button", { name: "確認する", exact: true }).click();
  await parentPage.locator(".finder-introductions .shop-introduction").waitFor();
  assert.match(await parentPage.locator(".finder-introductions").innerText(), /文具の小箱/);
  assert.equal(await parentPage.locator(".finder-introductions .candidate-button").count(), 0);
  assert.ok(guideCalls.some(call => call.params?.name === "list_products"));
  assert.ok(!guideCalls.some(call => call.params?.name === "purchase"));
  await parentPage.screenshot({ path: "test-results/shop-agent-introduction.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log("PASS: ordinary shop import, independent agent/reservation support, no-date introductions, read-only product inquiries, AI genre defaults, preview without saving, edits, reorder, delete, responsive layout and restaurant MCP regression. LLM responses were scripted.");
} finally {
  await browser?.close();
  if (parent && parent.exitCode === null) { const stopped = new Promise(resolve => parent.once("exit", resolve)); parent.kill("SIGTERM"); await stopped; }
  if (admin) await new Promise(resolve => admin.close(resolve));
  if (cuisineAI) await new Promise(resolve => cuisineAI.close(resolve));
  if (shopWebsite) await new Promise(resolve => shopWebsite.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}

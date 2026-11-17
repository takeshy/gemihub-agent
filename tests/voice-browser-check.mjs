// Real microphone processing, authenticated WebSocket, normal chat tools and shop iframe/relay.
// Gemini text/Live responses are fixtures; no paid API calls or production mutations.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "playwright/test";
import { initializeParent } from "../infra/dev/init-parent.mjs";
import { publicAi, memoryAiState } from "../apps/shop/server/public-ai.ts";
import { createPublicLiveUpgrade } from "../apps/shop/server/public-live.ts";

const codeRoot = fileURLToPath(new URL("../", import.meta.url)), oldCwd = process.cwd();
const scratch = await mkdtemp(join(tmpdir(), "guide-voice-browser-"));
let finder, shop, store, browser, liveParameters;
const textCalls = [], voiceResults = [], frames = [], errors = [], shopRequests = [];
let finderOrigin, shopOrigin, ended = 0;
const serverKey = "fixture-server-key-not-public";
let releaseReview;
const fixtureProvider = async (_url, options) => {
  const body = JSON.parse(options.body); textCalls.push(body);
  const receipts = body.messages.filter(message => message.role === "tool");
  const latest = body.messages.filter(message => message.role === "user").at(-1).content;
  const parent = body.tools.some(tool => tool.function.name === "website_search_chat_documents");
  const tool = (name, args) => ({ tool_calls: [{ index: 0, id: `fixture-${textCalls.length}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
  let delta;
  if (parent) {
    if (!receipts.length) delta = latest.includes("こまど") ? tool("website_open_shop", { shopId: "komado", target: "shop" }) : latest.includes("灯") ? tool("website_open_shop", { shopId: "akari", target: "shop" }) : tool("website_search_chat_documents", { query: "図書館 開館時間" });
    else if (latest.includes("こまど")) delta = { content: "文具と器 こまどを開きました。お店とお話しください。" };
    else if (latest.includes("灯")) delta = { content: "炉端 灯を開きました。お店とお話しください。" };
    else { const result = JSON.parse(receipts.at(-1).content).result; assert.equal(result.results[0].source, "図書館の利用案内.md"); delta = { content: "図書館は午前9時開館です。資料: 図書館の利用案内.md" }; }
  } else {
    if (latest === "確認画面を見てから回答して" && body.messages.at(-1)?.role === "user") await new Promise(resolve => { releaseReview = resolve; });
    // This is the selected shop's real assistant, loaded in its own frame with its own tools.
    if (body.tools.some(tool => tool.function.name === "website_get_reservation_page_state")) {
      delta = receipts.length ? { content: "炉端 灯です。席のみの予約も受け付けています。" } : tool("website_get_reservation_page_state", {});
    } else {
      assert.ok(body.tools.some(tool => tool.function.name === "mcp_get_shop_info"));
      assert.ok(!body.tools.some(tool => /place_reservation|check_availability|find_menu_items/.test(tool.function.name)));
      if (receipts.length) {
        assert.match(receipts.at(-1).content, /作家の器/);
        assert.match(receipts.at(-1).content, /12:00/);
      }
      delta = receipts.length ? { content: "文具と器 こまどは土曜12時から21時です。作家の器と手帳を扱っています。" } : tool("mcp_get_shop_info", {});
    }
    assert.ok(!JSON.stringify(body).includes("図書館の利用案内"), "parent conversation never enters the shop");
  }
  return new Response(`data: ${JSON.stringify({ model: body.model, choices: [{ index: 0, delta, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
};
const listen = async server => { await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); return `http://127.0.0.1:${server.address().port}`; };
const emitQuestion = question => liveParameters.callbacks.onmessage({ toolCall: { functionCalls: [{ id: `live-${voiceResults.length}`, name: (question.includes("灯") || question.includes("こまど")) ? "ask_guide" : "consult", args: { question } }] } });
try {
  await initializeParent({ root: scratch });
  process.env.DEMO_MODE = "true"; process.env.GEMINI_API_KEY = serverKey;
  process.chdir(join(codeRoot, "apps/shop"));
  const [{ createApp }, { Store }, { seedRestaurantDemo }] = await Promise.all([import("../apps/shop/server/app.ts"), import("../apps/shop/server/store.ts"), import("../apps/shop/scripts/seed-restaurant-demo.ts")]);
  store = new Store(":memory:"); await seedRestaurantDemo(store, new Date());
  const { sample, shopSchema } = await import("../apps/shop/server/domain.ts");
  const retailConfig = shopSchema.parse({ ...structuredClone(sample), industry: "other", name: "文具と器 こまど", products: ["作家の器", "手帳"], menus: [], staff: [], ownerBooking: true,
    hours: { start: "12:00", end: "21:00", closedWeekdays: [0, 1, 2, 3, 4, 5], holidays: [] } });
  await store.saveShop({ id: "komado", slug: "komado", owner: "komado-owner@example.com", published: retailConfig, publication: "public", draft: null, revision: 1, history: [] });
  shop = createApp(store);
  const shopGateway = publicAi({ env: { GEMINI_API_KEY: serverKey }, state: memoryAiState(), fetch: fixtureProvider });
  const [serveShop] = shop.listeners("request"); shop.removeListener("request", serveShop);
  shop.on("request", async (req,res) => { if (!(await shopGateway.handle(req,res,[shopOrigin]))) serveShop(req,res); });
  shop.removeAllListeners("upgrade");
  shop.on("upgrade", createPublicLiveUpgrade({ authorize: shopGateway.authorizeLive, allowedOrigins: () => [shopOrigin], env: { GEMINI_API_KEY: serverKey }, connector: async parameters => {
    liveParameters=parameters;
    assert.deepEqual(parameters.config.tools[0].functionDeclarations.map(tool=>tool.name),["consult"]);
    assert.match(String(parameters.config.systemInstruction), /current shop/);
    return { close(){ended++;}, sendRealtimeInput(input){frames.push(input);}, sendToolResponse(value){
      const response=value.functionResponses[0].response; voiceResults.push(response);
      parameters.callbacks.onmessage({serverContent:{outputTranscription:{text:response.answer},modelTurn:{parts:[{inlineData:{data:"AAAAAA==",mimeType:"audio/pcm;rate=24000"}}]},turnComplete:true}});
    }};
  } }));
  shopOrigin = await listen(shop); process.env.APP_ORIGIN = shopOrigin;
  const registry = { id: "akari", name: "炉端 灯", area: "東京", cuisine: "和食", pageUrl: shopOrigin + "/s/akari/", networkUrl: shopOrigin + "/s/akari/agent/reservation_concierge", reservationEnabled: false };
  await writeFile(join(scratch, "site/shop-registry.js"), `export const shops=${JSON.stringify([registry, { ...registry, id: "komado", name: "文具と器 こまど", cuisine: "雑貨", pageUrl: shopOrigin + "/s/komado", networkUrl: shopOrigin + "/s/komado/agent/shop_guide" }])};`);
  await writeFile(join(scratch, "site/chat-documents.json"), JSON.stringify({ version: 1, documents: [{ id: "library", name: "図書館の利用案内.md", text: "中央図書館は午前9時に開館します。", updatedAt: "2026-11-16" }] }));
  const gateway = publicAi({ env: { GEMINI_API_KEY: serverKey }, state: memoryAiState(), fetch: fixtureProvider });
  finder = createServer(async (req, res) => {
    if (await gateway.handle(req, res, [finderOrigin])) return;
    try {
      const site = join(scratch, "site"); let path = resolve(site, "." + new URL(req.url, "http://local").pathname);
      if (path !== site && !path.startsWith(site + sep)) throw new Error();
      if ((await stat(path)).isDirectory()) path = join(path, "index.html");
      const data = await readFile(path);
      res.writeHead(200, { "Content-Type": /\.m?js$/.test(path) ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".json") ? "application/json" : "text/html; charset=utf-8", "Cache-Control": "no-store" }); res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  finder.on("upgrade", createPublicLiveUpgrade({ authorize: gateway.authorizeLive, allowedOrigins: () => [finderOrigin], env: { GEMINI_API_KEY: serverKey }, connector: async parameters => {
    liveParameters = parameters;
    return { close() { ended++; }, sendRealtimeInput(input) { frames.push(input); }, sendToolResponse(value) {
      const response = value.functionResponses[0].response; voiceResults.push(response);
      parameters.callbacks.onmessage({ serverContent: { outputTranscription: { text: response.answer }, modelTurn: { parts: [{ inlineData: { data: "AAAAAA==", mimeType: "audio/pcm;rate=24000" } }] }, turnComplete: true } });
    } };
  } }));
  finderOrigin = await listen(finder); process.env.AGENT_PARENT_URL = finderOrigin;
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  await mkdir(join(codeRoot, "test-results/voice"), { recursive: true });
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: width === 1280 ? "ja-JP" : "en-US", permissions: ["microphone"] });
    await context.addInitScript(() => {
      if (!navigator.mediaDevices) return;
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => { try { return await original(constraints); } catch (error) { console.error("Microphone fixture:", error.name, error.message); throw error; } };
    });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") console.error(message.text().slice(0, 300)); });
    page.on("request", request => { if (request.url().startsWith(shopOrigin)) shopRequests.push({ url: request.url(), body: request.postData(), headers: request.headers() }); });
    await page.goto(finderOrigin); await expect(page.locator("#voice-open")).toBeVisible();
    await expect(page.locator("body > .finder-voice-launcher")).toHaveCount(0);
    assert.equal(await page.locator("#voice-open").evaluate(button => button.closest(".finder-voice-entry").nextElementSibling.classList.contains("ns-inputbar")), true);
    assert.equal(await page.locator("#voice-open").evaluate(button => getComputedStyle(button).position), "static");
    await expect(page.locator("#finder-voice")).not.toBeVisible();
    assert.equal(await page.evaluate(async () => !!(await import("./script.js")).App.voice.stream), false, "loading the page does not start the microphone");
    await page.locator("#voice-open").click();
    await expect(page.locator("#finder-voice")).toBeVisible();
    await expect(page.locator(".finder-voice-mode")).toHaveText("音声モード");
    try { await expect(page.locator("#voice-start")).toHaveText("■ 音声を終了"); }
    catch (error) { console.error("Voice status:", await page.locator("#voice-status").textContent(), "Live connected:", !!liveParameters); throw error; }
    await expect.poll(() => frames.length).toBeGreaterThan(0);
    emitQuestion("図書館の開館時間を教えて");
    await expect(page.locator("#voice-spoken")).toContainText("図書館は午前9時");
    await expect(page.locator("#ns-msgs")).toContainText("資料: 図書館の利用案内.md");
    emitQuestion("炉端 灯と話したい");
    await expect(page.locator("#voice-target")).toHaveValue("akari");
    await expect(page.locator("#voice-spoken")).toContainText("炉端 灯を開きました");
    emitQuestion("席のみで予約できますか");
    await expect(page.locator("#voice-spoken")).toContainText("席のみの予約も受け付けています", { timeout: 20000 });
    await expect(page.frameLocator("#shop-page-frame").locator("#ns-msgs")).toContainText("席のみの予約も受け付けています");
    emitQuestion("文具と器 こまどと話したい");
    await expect(page.locator("#voice-target")).toHaveValue("komado");
    await expect(page.locator("#voice-spoken")).toContainText("こまどを開きました");
    emitQuestion("営業時間と扱う品を教えてください");
    await expect(page.locator("#voice-spoken")).toContainText("作家の器と手帳", { timeout: 20000 });
    const retailFrame = page.frameLocator("#shop-page-frame");
    await expect(retailFrame.locator("#ns-msgs")).toContainText("土曜12時から21時");
    await expect(retailFrame.locator("#ns-input")).toHaveAttribute("placeholder", await retailFrame.locator("html").getAttribute("lang") === "en" ? "Ask about hours or products…" : "営業時間や扱っている品について相談…");
    assert.equal(await retailFrame.locator("#reserve-form").count(), 0);
    assert.equal(await retailFrame.locator("html").getAttribute("data-agent-kind"), "shop");
    const repliesBeforeReview=voiceResults.length;
    emitQuestion("確認画面を見てから回答して");
    await expect.poll(() => typeof releaseReview).toBe("function");
    await retailFrame.locator("body").evaluate(body => {
      const dialog=document.createElement("dialog"); dialog.id="voice-review-fixture";
      const button=document.createElement("button"); button.textContent="確認を終える"; button.onclick=()=>dialog.close(); dialog.append(button); body.append(dialog); dialog.showModal();
    });
    await expect(page.locator("#finder-voice")).not.toBeVisible();
    assert.equal(await page.evaluate(async () => !!(await import("./script.js")).App.voice.stream), true, "review does not stop the active voice session");
    await retailFrame.getByRole("button",{name:"確認を終える",exact:true}).click();
    await expect(page.locator("#finder-voice")).toBeVisible();
    releaseReview(); releaseReview=undefined;
    await expect.poll(() => voiceResults.length).toBeGreaterThan(repliesBeforeReview);
    assert.match(voiceResults.at(-1).answer,/作家の器と手帳/);
    const callsBeforeForgery = textCalls.length;
    await page.evaluate(origin => document.getElementById("shop-page-frame").contentWindow.postMessage({ type: "gemihub:voice-question", channel: "forged", id: "forged", question: "must be ignored" }, origin), shopOrigin);
    await page.waitForTimeout(50);
    assert.equal(textCalls.length, callsBeforeForgery);
    assert.ok((await page.locator("#finder-voice").boundingBox()).x >= 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(codeRoot, `test-results/voice/shop-${width}.png`), fullPage: true });
    await page.locator("#voice-target").selectOption("");
    emitQuestion("図書館の開館時間を教えて");
    await expect.poll(() => voiceResults.at(-1)?.target).toBe("地域の案内");
    await page.locator("#voice-close").click();
    await expect(page.locator("#finder-voice")).not.toBeVisible();
    await expect(page.locator("#voice-open")).toBeFocused();
    assert.equal(await page.evaluate(async () => (await import("./script.js")).App.voice.stream), null);
    await page.evaluate(async()=>{const{App}=await import("./script.js");App.shopFrame.open("komado");});
    const embedded=page.frameLocator("#shop-page-frame");
    await expect(page.locator("#voice-open")).not.toBeVisible();
    await expect(embedded.locator("#voice-open")).not.toBeVisible();
    await embedded.locator("#assistant-toggle").click();
    await expect(embedded.locator("#assistant #voice-open")).toBeVisible();
    await embedded.locator("#assistant #voice-open").click();
    await expect(page.locator("#voice-start")).toHaveText("■ 音声を終了");
    await expect(page.locator("#voice-target")).toHaveValue("komado");
    await page.keyboard.press("Escape");
    await expect(page.locator("#finder-voice")).not.toBeVisible();
    assert.equal(await page.evaluate(async () => { const voice=(await import("./script.js")).App.voice; return !voice.stream && !voice.ws && !voice.input && !voice.output; }), true, "closing the dialog stops microphone, connection and audio contexts");
    await embedded.locator("#assistant-close").click();
    await expect(embedded.locator("#voice-open")).not.toBeVisible();
    await expect(embedded.locator("#assistant-toggle")).toBeVisible();
    for(const slug of ["komado","akari"]) {
      const standalone=await context.newPage(); standalone.on("pageerror",error=>errors.push(error.message));
      await standalone.goto(`${shopOrigin}/s/${slug}/`);
      await expect(standalone.locator("#voice-open")).toBeAttached({timeout:15000});
      await expect(standalone.locator("#voice-open")).not.toBeVisible();
      await standalone.locator("#assistant-toggle").click();
      const launcher=standalone.locator("#assistant #voice-open");
      await expect(launcher).toBeVisible();
      assert.equal(await launcher.evaluate(button=>button.closest(".shop-voice-controls").nextElementSibling.classList.contains("ns-inputbar")),true);
      await expect(standalone.locator("#finder-voice")).not.toBeVisible();
      await standalone.screenshot({path:join(codeRoot,`test-results/voice/standalone-entry-${slug}-${width}.png`),fullPage:true});
      await launcher.click();
      const english=await standalone.locator("html").getAttribute("lang")==="en";
      await expect(standalone.locator("#voice-start")).toHaveText(english?"■ End voice":"■ 音声を終了");
      await expect(standalone.locator("#voice-target")).toHaveValue(slug);
      await expect(standalone.locator("#voice-target")).toBeDisabled();
      await expect(standalone.locator("#voice-target option")).toHaveCount(1);
      const count=voiceResults.length;
      emitQuestion(slug==="komado"?"営業時間と扱う品を教えてください":"席のみで予約できますか");
      await expect.poll(()=>voiceResults.length).toBeGreaterThan(count);
      await expect(standalone.locator("#voice-spoken")).toContainText(slug==="komado"?"作家の器と手帳":"席のみの予約も受け付けています");
      if(slug==="komado" && width===1280) {
        const replies=voiceResults.length; emitQuestion("確認画面を見てから回答して");
        await expect.poll(()=>typeof releaseReview).toBe("function");
        await standalone.evaluate(()=>{const dialog=document.createElement("dialog");dialog.id="local-voice-review";const button=document.createElement("button");button.textContent="確認を終える";button.onclick=()=>dialog.close();dialog.append(button);document.body.append(dialog);dialog.showModal();});
        await expect(standalone.locator("#finder-voice")).not.toBeVisible();
        assert.equal(await standalone.evaluate(async()=>!!(await import("./agent/site.js")).AssistantMount.voice.stream),true);
        await standalone.getByRole("button",{name:"確認を終える",exact:true}).click();
        await expect(standalone.locator("#finder-voice")).toBeVisible();
        releaseReview();releaseReview=undefined;
        await expect.poll(()=>voiceResults.length).toBeGreaterThan(replies);
      }
      assert.equal(await standalone.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await standalone.screenshot({path:join(codeRoot,`test-results/voice/standalone-${slug}-${width}.png`),fullPage:true});
      await standalone.locator("#voice-close").click();
      await expect(standalone.locator("#finder-voice")).not.toBeVisible();
      await expect(launcher).toBeFocused();
      await standalone.close();
    }
    await context.close();
  }
  for (const request of shopRequests) assert.ok(!JSON.stringify(request).includes(serverKey));
  assert.deepEqual(errors, []); assert.equal(ended, 8);
  console.log(`PASS: real microphone PCM/WebSocket, guide document answers, voice-selected restaurant and other-industry shop, read-only shop MCP, shop chat/relay, return to guide and cleanup on desktop/mobile (${frames.length} audio frames, ${voiceResults.length} voice replies)`);
} finally {
  await browser?.close();
  for (const server of [finder, shop]) if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await store?.close(); process.chdir(oldCwd); await rm(scratch, { recursive: true, force: true });
}

// Hold the final fixture model response open: cards must wait and follow the answer.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join, sep } from "node:path";
import { chromium, expect } from "playwright/test";

const root = fileURLToPath(new URL("../site/", import.meta.url));
const nail = { id: "nail", name: "Num05", area: "横浜市港北区", cuisine: "ネイル・美容サービス", description: "気さくなお店", pageUrl: "https://nail.example/", networkUrl: "", reservationEnabled: false };
const other = { ...nail, id: "other", name: "雑貨のお店", cuisine: "雑貨", pageUrl: "https://other.example/" };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://local").pathname;
    const json = data => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
    if (path === "/api/ai/config") return json({ managed: true });
    if (path === "/api/ai/session") return json({ token: "fixture-session", model: "fixture-model", router: "/api/ai/v1" });
    if (path === "/api/ai/v1/models") return json({ data: [{ id: "fixture-model" }] });
    if (path === "/shop-registry.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(`export const shops = ${JSON.stringify([nail, other])};`); return;
    }
    let file = resolve(root, "." + path);
    if (file !== resolve(root) && !file.startsWith(resolve(root) + sep)) throw new Error("outside");
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    res.writeHead(200, { "Content-Type": /\.m?js$/.test(file) ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".json") ? "application/json" : "text/html" });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || "/snap/bin/chromium", args: ["--no-sandbox"] });
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: "ja-JP" });
    const page = await context.newPage(), errors = [], external = [];
    let modelCalls = 0, release;
    const finalReady = new Promise(resolve => { release = resolve; });
    page.on("pageerror", error => errors.push(error.message));
    await context.route("https://**/*", route => { external.push(route.request().url()); return route.abort(); });
    await page.route("**/api/ai/v1/chat/completions", async route => {
      const body = route.request().postDataJSON(); modelCalls++;
      const receipts = body.messages.filter(message => message.role === "tool");
      let delta;
      if (!receipts.length) {
        delta = { tool_calls: [{ index: 0, id: "find-nail", type: "function", function: { name: "website_show_shop_introductions", arguments: JSON.stringify({ cuisine: "ネイルサロン" }) } }] };
      } else {
        assert.equal(receipts.length, 1);
        assert.deepEqual(JSON.parse(receipts[0].content).result.shops, [nail]);
        await finalReady;
        delta = { content: "店舗サイトで詳しくご覧いただけます。" };
      }
      await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n` });
    });
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => window.__nsweb?.engine && !document.getElementById("ns-send").disabled);
      await page.locator("#ns-input").fill("ネイルサロンを探している");
      await page.locator("#ns-send").click();
      const cards = page.locator(".finder-introductions .shop-introduction");
      await expect.poll(() => modelCalls).toBe(2); // Search finished; final answer is still held.
      await expect(page.locator(".ns-inputbar")).toHaveAttribute("data-turn-active", "true");
      await expect(cards).toHaveCount(0);
      release();
      await expect(page.locator(".ns-inputbar")).toHaveAttribute("data-turn-active", "false");
      await expect(page.locator("#ns-msgs")).toContainText("店舗サイトで詳しくご覧いただけます。");
      await expect(cards).toHaveCount(1);
      await expect(cards).toContainText("Num05");
      await expect(cards.getByRole("link")).toHaveAttribute("href", nail.pageUrl);
      await expect(cards.locator(".candidate-button")).toHaveCount(0);
      const order = () => page.locator("#ns-msgs > .ns-msg").evaluateAll(messages => messages.slice(1).map(message => message.classList.contains("user") ? "question" : message.classList.contains("finder-introductions") ? "cards" : "answer"));
      assert.deepEqual(await order(), ["question", "answer", "cards"]);
      await page.evaluate(async () => {
        const { App } = await import("/script.js");
        App.render("turn"); App.render("turn");
      });
      await expect(cards).toHaveCount(1); // Re-rendering must not duplicate or reorder results.
      assert.deepEqual(await order(), ["question", "answer", "cards"]);
      assert.equal(modelCalls, 2);
      assert.deepEqual(external, []);
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.locator(".assistant-chat-menu > summary").click();
      await page.locator("#ns-newchat").click();
      await expect(cards).toHaveCount(0);
      console.log(`${width}px: question, answer, then nail card; two model calls; no shop contact, booking controls or duplicate cards.`);
    } finally { release(); await context.close(); }
  }
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}

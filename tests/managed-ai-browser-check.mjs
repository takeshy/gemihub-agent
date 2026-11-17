import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "playwright/test";
import { initializeParent } from "../infra/dev/init-parent.mjs";

const root = fileURLToPath(new URL("../", import.meta.url)), originalCwd = process.cwd();
const scratch = await mkdtemp(join(tmpdir(), "managed-ai-browser-"));
const nativeFetch = globalThis.fetch, serverKey = "server-secret-never-in-browser", calls = [];
const sse = content => `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
process.env.DEMO_MODE = "true"; process.env.GEMINI_API_KEY = serverKey; process.env.GEMINI_MODEL = "gemini-4-hydrogen";
globalThis.fetch = async (url, options) => {
  if (String(url) === "https://generativelanguage.googleapis.com/v1beta/decisions") {
    assert.equal(options.headers["x-goog-api-key"], serverKey);
    return Response.json({ answers: {} }); // Ambiguous greetings keep the normal conversation path.
  }
  if (String(url) === "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions") {
    assert.equal(options.headers.Authorization, `Bearer ${serverKey}`); calls.push(JSON.parse(options.body));
    return new Response(sse("Managed Gemini fixture answer."), { headers: { "Content-Type": "text/event-stream" } });
  }
  return nativeFetch(url, options);
};
let shop, finder, browser;
try {
  await initializeParent({ root: scratch });
  process.chdir(join(root, "apps/shop"));
  const [{ createApp }, { Store }, { seedRestaurantDemo }] = await Promise.all([import("../apps/shop/server/app.ts"), import("../apps/shop/server/store.ts"), import("../apps/shop/scripts/seed-restaurant-demo.ts")]);
  const store = new Store(":memory:"); await seedRestaurantDemo(store, new Date());
  shop = createApp(store); await new Promise(resolve => shop.listen(0, "127.0.0.1", resolve));
  const shopOrigin = `http://127.0.0.1:${shop.address().port}`; process.env.APP_ORIGIN = shopOrigin;
  finder = createServer(async (req, res) => {
    if (req.url.startsWith("/api/ai/")) {
      const proxy = request(shopOrigin + req.url, { method: req.method, headers: { ...req.headers, host: new URL(shopOrigin).host } }, upstream => { res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res); });
      proxy.on("error", () => { res.writeHead(502); res.end(); }); req.pipe(proxy); return;
    }
    try {
      const path = resolve(join(scratch, "site"), "." + new URL(req.url, "http://localhost").pathname);
      if (!path.startsWith(join(scratch, "site") + sep) && path !== join(scratch, "site")) throw new Error("outside");
      const file = (await stat(path)).isDirectory() ? join(path, "index.html") : path;
      const type = /\.m?js$/.test(file) ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".json") ? "application/json" : "text/html";
      res.writeHead(200, { "Content-Type": type }); res.end(await readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => finder.listen(0, "127.0.0.1", resolve));
  const finderOrigin = `http://127.0.0.1:${finder.address().port}`; process.env.AGENT_PARENT_URL = finderOrigin;
  await mkdir(join(root, "test-results/managed-ai"), { recursive: true });
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || "/snap/bin/chromium", args: ["--no-sandbox"] });
  for (const width of [1440, 390]) for (const [name, url] of [["finder", finderOrigin], ["shop", `${shopOrigin}/s/akari/reserve`]]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: "ja-JP" }), page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") console.error(`${name} console: ${message.text().slice(0, 500)}`); });
    page.on("response", response => { if (response.status() >= 400) console.error(`${name} HTTP ${response.status()}: ${response.url()}`); });
    await context.route("https://**/models", route => route.fulfill({ contentType: "application/json", body: '{"data":[]}' }));
    await context.route("https://**/chat/completions", route => {
      assert.equal(route.request().headers().authorization, "Bearer fixture-byok-key");
      return route.fulfill({ contentType: "text/event-stream", body: sse("BYOK fixture answer.") });
    });
    const ready = () => page.waitForFunction(() => !!window.__nsweb?.engine && !document.getElementById("ai-settings-open").disabled);
    await page.goto(url); if (name === "shop") await page.locator("#assistant-toggle").click(); await ready();
    await expect(page.locator("#ai-setup-dialog")).toBeHidden();
    assert.notEqual(await page.evaluate(() => window.__nsweb.engine.byokKey), serverKey);
    await page.locator("#ns-input").fill("hello"); await page.locator("#ns-send").click(); await expect(page.locator("#ns-msgs")).toContainText("Managed Gemini fixture answer.");
    await page.locator("#ai-settings-open").click(); await expect(page.locator("#ai-connection-mode")).toHaveValue("managed"); await expect(page.locator("#ns-key")).toBeHidden();
    await page.locator("#ai-connection-mode").selectOption("byok"); await page.locator("#ai-provider").selectOption("OpenRouter"); await page.locator("#ns-key").fill("fixture-byok-key");
    await Promise.all([page.waitForNavigation(), page.locator("#ns-apply").click()]); await ready();
    assert.equal(await page.evaluate(() => window.__nsweb.engine.byokKey), "fixture-byok-key");
    await page.locator("#ns-input").fill("hello byok"); await page.locator("#ns-send").click(); await expect(page.locator("#ns-msgs")).toContainText("BYOK fixture answer.");
    await page.locator("#ai-settings-open").click(); await page.locator("#ai-connection-mode").selectOption("managed");
    await Promise.all([page.waitForNavigation(), page.locator("#ns-apply").click()]); await ready(); await expect(page.locator("#ai-setup-dialog")).toBeHidden();
    await page.locator("#ns-input").fill("hello managed again"); await page.locator("#ns-send").click(); await expect(page.locator("#ns-msgs")).toContainText("Managed Gemini fixture answer.");
    assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes(serverKey));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []); await page.screenshot({ path: join(root, `test-results/managed-ai/${name}-${width}.png`), fullPage: true });
    console.log(`${name} ${width}px: managed without a key, BYOK, managed again; server key stayed private.`); await context.close();
  }
  assert.ok(calls.length >= 8); await store.close();
} finally {
  await browser?.close();
  for (const server of [finder, shop]) if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  globalThis.fetch = nativeFetch; process.chdir(originalCwd); await rm(scratch, { recursive: true, force: true });
}

// Real admin, static host and browser runtime; model replies are fixtures, with no paid API calls.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { chromium, expect } from "playwright/test";
import { initializeParent } from "../infra/dev/init-parent.mjs";
import { createAdminServer } from "../admin/server.mjs";

const listen = async server => { await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); return `http://127.0.0.1:${server.address().port}`; };
const close = async server => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
const root = await mkdtemp(join(tmpdir(), "finder-documents-browser-"));
const extracted = "中央図書館の開館時間は午前9時から午後6時です。休館日は毎週月曜日です。";
const pdf = Buffer.from("%PDF-1.7 fixture");
let browser, admin, publicServer;
const errors = [], calls = [];
try {
  await initializeParent({ root });
  admin = createAdminServer({ root, auth: false, geminiApiKey: "fixture-key", fetch: async () =>
    Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: extracted }] } }] }) });
  const adminUrl = await listen(admin);
  publicServer = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://local").pathname;
      const json = value => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
      if (path === "/api/ai/config") return json({ managed: true, model: "fixture-model", router: "/api/ai/v1", defaultMode: "managed" });
      if (path === "/api/ai/session") return json({ token: "fixture-session", model: "fixture-model", router: "/api/ai/v1" });
      if (path === "/api/ai/v1/models") return json({ data: [{ id: "fixture-model" }] });
      const site = join(root, "site");
      let file = resolve(site, "." + path);
      if (file !== site && !file.startsWith(site + sep)) throw new Error("outside");
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": /\.m?js$/.test(file) ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".json") ? "application/json" : file.endsWith(".pdf") ? "application/pdf" : "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  const publicUrl = await listen(publicServer);
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  await mkdir("test-results/chat-documents", { recursive: true });
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: "ja-JP" });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.goto(adminUrl);
    await expect(page.locator("#chat-documents")).toBeVisible();
    const isPdf = width === 1280;
    const filename = `施設案内-${width}.${isPdf ? "pdf" : "md"}`;
    await page.locator("#document-file").setInputFiles(isPdf ? { name: filename, mimeType: "application/pdf", buffer: pdf }
      : { name: filename, mimeType: "text/markdown", buffer: Buffer.from(extracted + "\n<script>alert('data only')</script>") });
    await page.getByRole("button", { name: "本文を読み込む", exact: true }).click();
    await expect(page.locator("#document-preview")).toBeVisible();
    await expect(page.locator("#document-text")).toHaveValue(/午前9時/);
    await expect(page.locator("#documents-status")).toContainText("まだチャットには使われません");
    await page.getByRole("button", { name: "下書きを保存", exact: true }).click();
    await expect(page.locator("#documents-status")).toContainText("下書きを保存しました");
    assert.deepEqual(JSON.parse(await readFile(join(root, "site/chat-documents.json"), "utf8")).documents, []);

    const visitor = await context.newPage(); visitor.on("pageerror", error => errors.push(error.message));
    await visitor.route(publicUrl + "/api/ai/v1/chat/completions", async route => {
      const body = route.request().postDataJSON(); calls.push(body);
      assert.ok(body.messages.some(message => message.role === "system" && String(message.content).includes("地域案内窓口")), "the runtime receives the local guide role");
      const receipts = body.messages.filter(message => message.role === "tool");
      assert.ok(body.tools.some(tool => tool.function.name === "website_search_chat_documents"));
      let delta;
      if (!receipts.length) delta = { tool_calls: [{ index: 0, id: `documents-${calls.length}`, type: "function", function: { name: "website_search_chat_documents", arguments: JSON.stringify({ query: "中央図書館 開館時間" }) } }] };
      else {
        const receipt = JSON.parse(receipts.at(-1).content);
        assert.equal(receipt.status, "succeeded"); assert.equal(receipt.result.ok, true);
        const match = receipt.result.results[0];
        const link = match?.pdfUrl ? `\n[PDFを開く](${match.pdfUrl})` : "";
        delta = { content: match ? `${match.text}\n資料: ${match.source}${link}` : "公開資料から確認できませんでした。" };
      }
      const chunk = { model: "fixture-model", choices: [{ index: 0, delta, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }] };
      await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n` });
    });
    await visitor.goto(publicUrl);
    await visitor.waitForFunction(() => window.__nsweb?.engine && !document.querySelector("#ai-settings-open").disabled);
    await expect(visitor.locator("#ns-msgs .ns-msg.bot").first()).toContainText("イベントや公共施設、地域のお知らせ");
    await expect(visitor.locator("#ns-input")).toHaveAttribute("placeholder", "街の情報・イベント・お店について相談…");
    async function ask() {
      const count = await visitor.locator("#ns-msgs .ns-msg.bot").count();
      await visitor.locator("#ns-input").fill("中央図書館の開館時間を教えて");
      await visitor.locator("#ns-send").click();
      await expect(visitor.locator("#ns-msgs .ns-msg.bot")).toHaveCount(count + 1);
      await expect(visitor.locator("#agent-app .ns-inputbar")).not.toHaveAttribute("data-turn-active", "true");
      return visitor.locator("#ns-msgs .ns-msg.bot").last();
    }
    await expect(await ask()).toContainText("確認できませんでした");
    await page.getByRole("button", { name: "本文を確認", exact: true }).click();
    await page.locator("#document-text").fill("中央図書館の開館時間は午前10時から午後6時です。休館日は毎週月曜日です。");
    await page.getByRole("button", { name: "公開する", exact: true }).click();
    await expect(page.locator("#documents-status")).toContainText("公開しました");
    const answer = await ask();
    await expect(answer).toContainText("午前10時"); await expect(answer).toContainText(`資料: ${filename}`);
    let pdfUrl;
    if (isPdf) {
      const link = answer.getByRole("link", { name: "PDFを開く" });
      pdfUrl = await link.getAttribute("href");
      assert.deepEqual(Buffer.from(await (await fetch(pdfUrl)).arrayBuffer()), pdf);
      await link.click();
      const preview = visitor.getByRole("dialog", { name: "案内資料（PDF）" });
      await expect(preview).toBeVisible();
      await expect(preview.locator("iframe")).toHaveAttribute("src", pdfUrl);
      await preview.getByRole("button", { name: "閉じる", exact: true }).click();
      await expect(link).toBeFocused();
    }
    await expect(visitor.locator(".shop-introduction, .finder-results")).toHaveCount(0);
    for (const current of [page, visitor]) assert.equal(await current.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `test-results/chat-documents/admin-${width}.png`, fullPage: true });
    await visitor.screenshot({ path: `test-results/chat-documents/chat-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "公開をやめる", exact: true }).click();
    await expect(page.locator("#documents-status")).toContainText("公開をやめました");
    if (pdfUrl) assert.equal((await fetch(pdfUrl)).status, 404);
    await expect(await ask()).toContainText("確認できませんでした");
    page.once("dialog", dialog => dialog.accept());
    await page.locator("#documents-list").getByRole("button", { name: "削除", exact: true }).click();
    await expect(page.locator("#documents-empty")).toBeVisible();
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log(`PASS: upload/preview/private draft/edit/publish/source-grounded chat/unpublish/delete on desktop and mobile (${calls.length} fixture model calls)`);
} finally {
  await browser?.close(); if (admin) await close(admin); if (publicServer) await close(publicServer);
  await rm(root, { recursive: true, force: true });
}

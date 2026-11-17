// Storybook-only checks: all document and model responses come from its isolated fixtures.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "playwright/test";

const base = process.env.STORYBOOK_URL || "http://127.0.0.1:6005";
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
const errors = [], apiRequests = [];
try {
  await mkdir("test-results/chat-documents-storybook", { recursive: true });
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url()); });
    const show = async id => { await page.goto(`${base}/iframe.html?id=${id}&viewMode=story`); return page.frameLocator("#storybook-root iframe"); };
    let frame = await show("parent-admin--documents-empty");
    await expect(frame.locator("#chat-documents")).toBeVisible();
    await expect(frame.locator("#documents-empty")).toBeVisible();
    await frame.locator("#document-file").setInputFiles({ name: "回収日.txt", mimeType: "text/plain", buffer: Buffer.from("資源ごみの回収日は毎週水曜日です。") });
    await frame.getByRole("button", { name: "本文を読み込む", exact: true }).click();
    await expect(frame.locator("#document-text")).toHaveValue("資源ごみの回収日は毎週水曜日です。");
    await frame.getByRole("button", { name: "下書きを保存", exact: true }).click();
    await expect(frame.locator("#documents-list")).toContainText("下書き");
    await frame.getByRole("button", { name: "本文を確認", exact: true }).click();
    await frame.getByRole("button", { name: "公開する", exact: true }).click();
    await expect(frame.locator("#documents-list")).toContainText("公開中");
    await frame.getByRole("button", { name: "公開をやめる", exact: true }).click();
    await expect(frame.locator("#documents-list")).toContainText("下書き");
    page.once("dialog", dialog => dialog.accept());
    await frame.locator("#documents-list").getByRole("button", { name: "削除", exact: true }).click();
    await expect(frame.locator("#documents-empty")).toBeVisible();

    frame = await show("parent-admin--documents");
    await expect(frame.locator("#documents-list li")).toHaveCount(2);
    await expect(frame.locator("#documents-list")).toContainText("公開中");
    await expect(frame.locator("#documents-list")).toContainText("下書き");
    await page.screenshot({ path: `test-results/chat-documents-storybook/documents-${width}.png`, fullPage: true });

    frame = await show("parent-admin--document-preview");
    await expect(frame.locator("#document-preview")).toBeVisible();
    await expect(frame.locator("#document-text")).toHaveValue(/防災訓練/);
    await expect(frame.getByRole("button", { name: "公開する", exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/chat-documents-storybook/preview-${width}.png`, fullPage: true });

    frame = await show("parent-finder--document-answer");
    await expect(frame.locator("#ns-msgs")).toContainText("資料: 中央図書館の利用案内.md", { timeout: 20000 });
    await expect(frame.locator("#ns-msgs")).toContainText("午前9時");
    await expect(frame.locator("#ns-msgs")).not.toContainText("防災訓練");
    await expect(frame.locator(".shop-introduction, .finder-results")).toHaveCount(0);
    const overflow = await frame.locator("html").evaluate(element => element.scrollWidth > element.clientWidth);
    assert.equal(overflow, false);
    await page.screenshot({ path: `test-results/chat-documents-storybook/answer-${width}.png`, fullPage: true });
    frame = await show("parent-finder--voice-guide");
    await expect(frame.locator("#voice-open")).toBeVisible();
    await expect(frame.locator("#finder-voice")).not.toBeVisible();
    await frame.locator("#voice-open").click();
    await expect(frame.locator("#voice-spoken")).toContainText("中央図書館", { timeout: 15000 });
    await expect(frame.locator("#voice-start")).toHaveText("■ 音声を終了");
    await frame.locator("#voice-close").click();
    frame = await show("parent-finder--voice-shop");
    await frame.locator("#voice-open").click();
    await expect(frame.locator("#voice-target")).toBeVisible();
    await frame.locator("#voice-target").selectOption("voice-demo");
    await expect(frame.locator("#voice-spoken")).toContainText("サンプル店の営業時間", { timeout: 15000 });
    await page.screenshot({ path: `test-results/chat-documents-storybook/voice-shop-${width}.png`, fullPage: true });
    await context.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(apiRequests, []);
  console.log("PASS: parent document Storybook stories, upload/publish/unpublish/delete and real search with fixture model answers on desktop/mobile; no live API calls");
} finally { await browser.close(); }

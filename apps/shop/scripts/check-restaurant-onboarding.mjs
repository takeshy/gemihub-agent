import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "playwright/test";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { asRestaurant, sample, planSummary } from "../server/domain.ts";
import { restaurantFeatureQuestion, additionalPagesQuestion, finalDetailsQuestion } from "../server/request-intent.ts";
import * as intelligence from "../server/ai.ts";
import { exampleTheme } from "../src/stories/themes.ts";

process.env.DEMO_MODE = "true";
delete process.env.GOOGLE_CLOUD_PROJECT;
const english = JSON.parse(await readFile("shared/en.json", "utf8"));
const store = new Store(":memory:");
const server = createApp(store, { ...intelligence, async propose(_text, _current, email, _demo, _images, _region, context) {
  const config = asRestaurant({ ...structuredClone(sample), name: context.shopName, industry: "restaurant", menus: [], notificationEmail: email,
    reservationsEnabled: context.reservationsEnabled, appearance: { accent: "sage", layout: "standard", imageUrl: "", theme: exampleTheme } });
  return { config, summary: planSummary(null, config) };
} });
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
process.env.APP_ORIGIN = origin;
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}), args: ["--no-sandbox"] });
  await mkdir("tmp/restaurant-onboarding", { recursive: true });
  for (const lang of ["ja", "en"]) for (const width of [1280, 390]) {
    const enabled = lang === "en";
    const label = text => lang === "en" ? english[text] || text : text;
    const shop = await store.createShop(`onboarding-${lang}-${width}@example.com`);
    const sid = randomUUID();
    await store.put("session", digest(sid), { user: { email: shop.owner, name: "Owner", role: "owner", shopId: shop.id }, expires: Date.now() + 600000 });
    const context = await browser.newContext({ viewport: { width, height: 950 }, locale: lang === "en" ? "en-US" : "ja-JP" });
    await context.addCookies([{ name: "gemihub_session", value: sid, url: origin }]);
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?lang=${lang}`);
    await page.getByRole("button", { name: label("はじめる"), exact: true }).click();
    const composer = page.getByRole("textbox", { name: label("AIに伝えたいこと"), exact: true });
    const send = async text => { await expect(composer).toBeEnabled(); await composer.fill(text); await composer.press("Control+Enter"); };
    await send(lang === "en" ? "The shop name is Akari. It is a restaurant. No logo." : "店名は灯。飲食店です。ロゴはなし。");
    await expect(page.getByRole("log")).toContainText(label(restaurantFeatureQuestion));
    await page.screenshot({ path: `tmp/restaurant-onboarding/features-${lang}-${width}.png`, fullPage: true });
    await send(enabled ? "1 and 4" : "2と4");
    await expect(page.getByRole("log")).toContainText(label(additionalPagesQuestion));
    await send(lang === "en" ? "No additional pages" : "追加のページはありません");
    await expect(page.getByRole("log")).toContainText(label(finalDetailsQuestion));
    await send(lang === "en" ? "Nothing else" : "ほかにはありません");
    await expect(page.locator(".theme-preview")).toBeVisible({ timeout: 20000 });
    const plan = (await store.list("plan")).find(plan => plan.shopId === shop.id);
    assert.equal(plan.config.reservationsEnabled, enabled);
    assert.deepEqual(plan.config.appearance.articles, { blogs: false, announcements: true });
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await context.close();
    console.log(`${lang} ${width}px: reservation choice shown in chat and preserved in the generated plan (${enabled}).`);
  }
} finally {
  await browser?.close(); server.closeAllConnections();
  await new Promise(resolve => server.close(resolve)); await store.close();
}

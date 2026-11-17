import assert from "node:assert/strict";
import test from "node:test";
import { GUIDE_GREETING, guideGreeting } from "../site/guide-copy.js";
import { defaultDesign, renderDesign, previewDesign } from "../admin/site-design.mjs";

test("legacy shop-only greetings become local guidance while retaining the area", () => {
  assert.equal(guideGreeting(), GUIDE_GREETING);
  assert.equal(guideGreeting("どんなお店をお探しですか？雑貨店などのお店紹介から、飲食店の予約相談までお手伝いします。"), GUIDE_GREETING);
  assert.equal(guideGreeting("大倉山でどんなお店をお探しですか？美容サロンや雑貨店のご紹介から、飲食店の予約相談までお手伝いします。"), "大倉山の街について、どんなことを知りたいですか？イベントや公共施設、地域のお知らせ、お店の紹介までご案内します。");
  for (const custom of ["今月の地域のイベントをご案内します。", "どんなお店をお探しですか？ご相談ください。", "Welcome to our local guide."]) assert.equal(guideGreeting(custom), custom);
});

test("saved designs and editor previews use the updated greeting without replacing custom layout", async () => {
  const config = await defaultDesign();
  config.copy.greeting = "大倉山でどんなお店をお探しですか？美容サロンや雑貨店のご紹介から、飲食店の予約相談までお手伝いします。";
  config.title = "大倉山で暮らす";
  const page = await renderDesign(config);
  const preview = await previewDesign(config, []);
  for (const html of [page.html, preview]) {
    assert.match(html, /大倉山の街について/);
    assert.match(html, /<title>大倉山で暮らす<\/title>/);
    assert.doesNotMatch(html, /どんなお店をお探し/);
  }
  assert.match(config.copy.greeting, /どんなお店をお探し/, "rendering does not mutate saved input");
});

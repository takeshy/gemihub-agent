import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FunctionalOverview } from "../src/FunctionalOverview.tsx";
import { sample, type ShopConfig } from "../server/domain.ts";
import { requestLocale } from "../server/i18n.ts";

const overview = (config: ShopConfig, locale: "ja" | "en" = "ja") => requestLocale.run(locale, () => renderToStaticMarkup(React.createElement(FunctionalOverview, { config })));

test("restaurant overview explains seat reservations without staff selection", () => {
  const config: ShopConfig = { ...sample, industry: "restaurant" };
  const html = overview(config);
  assert.match(html, /人数・日時・/);
  assert.match(html, /席のみ・コースを選ぶ/);
  assert.match(html, /変更・キャンセルはお店へ/);
  assert.doesNotMatch(html, /担当者|自分の予約を確認|必要ならキャンセル/);
  const english = overview(config, "en");
  assert.match(english, /party size/);
  assert.doesNotMatch(english, /staff member|人数|コース/);
});

test("restaurant without reservations omits booking features", () => {
  const html = overview({ ...sample, industry: "restaurant", reservationsEnabled: false });
  assert.doesNotMatch(html, /予約する|予約を確かめる|予約を管理|予約の受付/);
  assert.match(html, /お店を知る/);
  assert.match(html, /お問い合わせ/);
});

test("salon retains service and staff booking instructions", () => {
  assert.match(overview(sample), /メニュー・担当者・/);
  assert.match(overview(sample), /自分の予約を確認/);
});

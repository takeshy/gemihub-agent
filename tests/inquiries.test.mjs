import assert from "node:assert/strict";
import test from "node:test";
import { FinderPage } from "../site/finder.js";
import { shops } from "../site/shop-registry.js";
import { ShopInquiries, installInquiryPolicy } from "../site/inquiries.js";

function arrange(review = async () => true, registry = shops, message = "ジャンルと場所は指定なし") {
  const page = new FinderPage(registry, { now: () => new Date("2026-11-14T09:00:00Z") });
  page.setConditions({ date: "2026-12-18", time: "19:00", partySize: 12 });
  const inquiries = new ShopInquiries(() => page, review, () => message);
  return { page, inquiries, confirm: (extra = {}) => inquiries.confirm({ cuisine: "", area: "", expectedVersion: page.version, ...extra }) };
}

test("missing genre and place cannot silently become unrestricted inquiries", async () => {
  let shown = false;
  const { inquiries, confirm } = arrange(async () => { shown = true; return true; }, shops, "明日の18時に2人、席だけで探して");
  const result = await confirm();
  assert.equal(result.ok, false);
  assert.match(result.reason, /ジャンルと場所を先に/);
  assert.equal(shown, false);
  assert.equal(inquiries.activePlan(), null);
  assert.deepEqual(inquiries.preferences, { cuisine: null, area: null });
  inquiries.getUserMessage = () => "おまかせ・どこでも";
  assert.equal((await confirm()).count, 3);
  assert.equal(shown, true);
});

test("the count and exact targets come from parent metadata before any connection", async () => {
  let shown;
  const { inquiries, confirm } = arrange(async plan => { shown = plan; return true; });
  assert.equal(inquiries.canContactNetwork(shops[2].networkUrl), false);
  assert.equal(inquiries.decision({ kind: "network", peerOrigin: "127.0.0.1:3000" }), "decline");
  const result = await confirm({ cuisine: "中華", area: "横浜" });
  assert.equal(result.approved, true);
  assert.equal(result.count, 1);
  assert.deepEqual(shown.shops.map(shop => shop.id), ["kanton-ryu"]);
  assert.equal(inquiries.canContactNetwork(shops[2].networkUrl), true);
  assert.equal(inquiries.canContactNetwork(shops[0].networkUrl), false);
});

test("one decision covers all selected shops, not a separate card per shop", async () => {
  let decisions = 0;
  const { inquiries, confirm } = arrange(async () => { decisions++; return true; });
  const result = await confirm();
  assert.equal(result.count, 3);
  for (const shop of shops) {
    assert.equal(inquiries.decision({ kind: "network", peerOrigin: new URL(shop.networkUrl).host }), "allow");
    assert.equal(inquiries.canContactNetwork(shop.networkUrl), true);
  }
  assert.equal(decisions, 1);
  assert.equal(inquiries.decision({ kind: "mcp", peerOrigin: "other.example" }), "decline");
});

test("declining, stale dates and missing preferences make no approved plan", async () => {
  const { inquiries, page, confirm } = arrange(async () => false);
  assert.equal((await confirm()).approved, false);
  assert.equal(inquiries.activePlan(), null);
  assert.equal((await inquiries.confirm({ expectedVersion: page.version })).ok, false);
  assert.equal((await confirm({ expectedVersion: 0 })).ok, false);
  page.now = () => new Date("2026-12-19");
  assert.equal((await confirm()).ok, false);
});

test("zero matches do not show a confirmation or silently broaden the search", async () => {
  let shown = false;
  const { confirm } = arrange(async () => { shown = true; return true; });
  const result = await confirm({ cuisine: "中華", area: "新宿" });
  assert.equal(result.count, 0);
  assert.equal(shown, false);
});

test("condition changes during confirmation invalidate acceptance", async () => {
  let finish;
  const { page, inquiries, confirm } = arrange(() => new Promise(resolve => { finish = resolve; }));
  const pending = confirm();
  page.setConditions({ ...page.conditions, partySize: 2 });
  finish(true);
  assert.equal((await pending).ok, false);
  assert.equal(inquiries.activePlan(), null);
});

test("new conditions and new conversations cannot reuse the previous approval", async () => {
  const { page, inquiries, confirm } = arrange();
  await confirm();
  page.setConditions({ ...page.conditions, partySize: 2 });
  assert.equal(inquiries.activePlan(), null);
  await confirm({ cuisine: "中華", area: "横浜" });
  inquiries.reset();
  assert.equal(inquiries.activePlan(), null);
  assert.deepEqual(inquiries.preferences, { cuisine: null, area: null });
});

test("blank filters cannot silently widen previously specified preferences", async () => {
  const { inquiries, confirm } = arrange();
  await confirm({ cuisine: "中華", area: "横浜" });
  inquiries.getUserMessage = () => "日時だけ変えてください";
  assert.equal((await confirm()).count, 1);
  assert.deepEqual(inquiries.preferences, { cuisine: "中華", area: "横浜" });
  inquiries.getUserMessage = () => "ジャンルと場所は指定なし";
  assert.equal((await confirm()).count, 3);
});

test("resolver guards keep scheme, port and network identity scoped to the confirmed plan", async () => {
  const { inquiries, confirm } = arrange();
  const calls = [];
  const engine = { consent: new Map([["127.0.0.1:3000", "always"]]),
    resolveRemote: async url => calls.push(url), resolveMcp: async ref => calls.push(ref) };
  installInquiryPolicy(engine, inquiries);
  assert.equal(engine.consent.size, 0);
  assert.throws(() => engine.resolveRemote(shops[2].networkUrl), /先に/);
  await confirm({ cuisine: "中華", area: "横浜" });
  assert.throws(() => engine.resolveRemote(shops[0].networkUrl), /先に/);
  assert.throws(() => engine.resolveRemote(shops[2].networkUrl.replace("http:", "https:")), /先に/);
  assert.throws(() => engine.resolveMcp({ url: "https://127.0.0.1:3000/mcp" }), /含まれない/);
  assert.throws(() => engine.resolveMcp({ url: "http://127.0.0.1:3001/mcp" }), /含まれない/);
  assert.equal(calls.length, 0);
  await engine.resolveRemote(shops[2].networkUrl);
  await engine.resolveMcp({ url: "http://127.0.0.1:3000/s/kanton-ryu/agent/mcp" });
  assert.equal(calls.length, 2);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { allowDemoShoppers } from "../server/auth.ts";
import { Store } from "../server/store.ts";
import { seedRestaurantDemo } from "../scripts/seed-restaurant-demo.ts";
// @ts-expect-error The page script is plain JavaScript served to the browser.
import { ReservePage, parseCarriedRequest, rememberRequest, recallRequest, forgetRequest } from "../agentic/site/reserve-page.js";

process.env.DEMO_MODE = "true";
allowDemoShoppers();

/** Just enough of a document for the page's own rendering: elements by id, with the properties it sets. */
function fakeDocument() {
  const elements = new Map<string, Record<string, unknown>>();
  const make = () => ({ value: "", textContent: "", hidden: false, children: [] as unknown[], addEventListener() {}, replaceChildren(...children: unknown[]) { this.children = children; }, scrollIntoView() {} });
  return { elements, getElementById(id: string) { if (!elements.has(id)) elements.set(id, make()); return elements.get(id)!; }, createElement: () => make() };
}

function fakeStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

async function page(t: { after: (fn: () => void) => void }, slug: string, lang = "ja", storage?: ReturnType<typeof fakeStorage>) {
  const store = new Store(":memory:");
  const seeded = await seedRestaurantDemo(store, new Date());
  const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = origin;
  t.after(() => { server.close(); void store.close(); });
  const request = (path: string, init: RequestInit = {}) => fetch(origin + path, { ...init, headers: { ...init.headers, Origin: origin, "X-Gemihub-Language": lang } });
  const config = (await (await request(`/api/public/${slug}`)).json()).config;
  const document = fakeDocument();
  return { store, seeded, document, page: new ReservePage({ slug, config, lang, fetch: request, document, storage }) };
}

test("conditions from another site are read from the fragment, and anything malformed is dropped", () => {
  assert.equal(parseCarriedRequest(""), null);
  assert.equal(parseCarriedRequest("#date=2026-12-18"), null, "only the versioned form is read");
  assert.deepEqual(parseCarriedRequest("#aw=v1&date=2026-12-18&time=19:00&people=12&course=wanted&budget=5000&avoid=shrimp"),
    { date: "2026-12-18", time: "19:00", partySize: 12, course: "wanted", budgetPerPerson: 5000, avoid: ["shrimp"] });
  assert.deepEqual(parseCarriedRequest("aw=v1&date=2026-11-14&time=19:00&people=2&course=none"), { date: "2026-11-14", time: "19:00", partySize: 2, course: "none" });
  assert.deepEqual(parseCarriedRequest("#aw=v1&date=18/12/2026&time=7pm&people=0&course=free&budget=-1&course_id=Bad Id&name=Morita&key=sk-secret"), { course: "any" }, "no name, key or bad value survives");
  const many = parseCarriedRequest("#aw=v1&avoid=shrimp,crab,a,b,c,d,e,f&avoid=<script>&avoid=" + "x".repeat(21));
  assert.deepEqual(many.avoid, ["shrimp", "crab", "a", "b", "c", "d", "e"], "the labelled allergens, then five free words");
});

test("the page's operations fill the form, check a reservation and make it, with the server's own rules", async t => {
  const { store, seeded, document, page: reserve } = await page(t, "akari");
  const date = seeded.banquetDate;
  const before = reserve.getState();
  assert.equal(before.today, seeded.today);
  assert.match(before.todayText, /^\d{4}-\d{2}-\d{2}（.）$/);
  assert.deepEqual(before.partySize, { min: 1, max: 24 });
  assert.deepEqual(before.courses.map((course: { id: string; priceText: string }) => [course.id, course.priceText]), [["winter-robata", "5,000円/人"], ["seafood-robata", "6,500円/人"]]);
  assert.equal(before.version, 0);

  // Refusals change nothing.
  for (const [args, field] of [[{ date: "18/12", partySize: 2 }, "date"], [{ date, partySize: 30 }, "partySize"], [{ date, partySize: 2, time: "19:10" }, "time"], [{ date, partySize: 2, courseId: "ebi-kushi" }, "courseId"], [{ date, partySize: 1, courseId: "winter-robata" }, "partySize"], [{ date, partySize: 15, time: "19:00" }, "time"]] as const) {
    const refused = await reserve.fillForm(args);
    assert.deepEqual([refused.ok, refused.field], [false, field], JSON.stringify(args));
  }
  assert.equal(reserve.getState().version, 0);
  assert.equal(reserve.getState().form.date, null);

  const filled = await reserve.fillForm({ date, time: "19:00", partySize: 12, courseId: "winter-robata", dietaryNote: " 1名えびNG " });
  assert.deepEqual([filled.ok, filled.version, filled.form.durationMinutes, filled.form.total, filled.form.totalText, filled.form.seatOnly, filled.form.dietaryNote], [true, 1, 120, 60000, "60,000円", false, "1名えびNG"]);
  assert.deepEqual(filled.form.times.find((slot: { time: string }) => slot.time === "19:00"), { time: "19:00", remaining: 14, fits: true });
  assert.equal(document.getElementById("reserve-date").value, date, "the visitor sees what the assistant filled in");
  assert.match(String(document.getElementById("reserve-summary").textContent), /12名／冬の炉端コース／合計 60,000円/);

  const base = { date, time: "19:00", partySize: 12, courseId: "winter-robata", name: " 森田 ", phone: "090-1234-5678", expectedVersion: 1, expectedTotal: 60000 };
  for (const [change, field] of [[{ name: " " }, "name"], [{ phone: "" }, "phone"], [{ phone: "09o-1234-5678" }, "phone"], [{ phone: "(+) - - -" }, "phone"], [{ expectedVersion: 0 }, "expectedVersion"], [{ expectedVersion: 2 }, "expectedVersion"], [{ expectedTotal: 55000 }, "expectedTotal"], [{ partySize: 11 }, "date"], [{ time: "" }, "time"]] as const) {
    const refused = await reserve.placeReservation({ ...base, ...change });
    assert.deepEqual([refused.ok, refused.field], [false, field], JSON.stringify(change));
    assert.equal((await reserve.reviewDetails({ ...base, ...change })).refusal, refused.reason, "the dialog refuses for the same reason, so it never opens");
  }
  const shop = (await store.list<import("../server/store.ts").Shop>("shop")).find(candidate => candidate.slug === "akari")!;
  assert.equal((await store.bookings(shop.id)).length, 4, "nothing was reserved by a refused call");

  const details = await reserve.reviewDetails(base);
  assert.deepEqual(details, { "日時": `${reserve.dateText(date)} 19:00`, "利用時間": "120分", "人数": "12名", "コース": "冬の炉端コース", "1人あたり": "5,000円/人", "合計": "60,000円 (お支払いは当日お店で。)", "食事の注記": "1名えびNG", "お名前": "森田", "電話番号": "090-1234-5678", "ご予約の確認": "ご予約後、お店から確認のお電話を差し上げます。", "キャンセル": "キャンセルは開始の24時間前までに、お店へ直接ご連絡ください。" });
  const receipt = await reserve.placeReservation(base);
  assert.deepEqual([receipt.ok, receipt.start, receipt.end, receipt.partySize, receipt.course, receipt.totalText], [true, "19:00", "21:00", 12, "冬の炉端コース", "60,000円"]);
  const stored = (await store.bookings(shop.id)).find(booking => booking.id === receipt.bookingId)!;
  assert.deepEqual([stored.name, stored.partySize, stored.courseId, stored.price, stored.dietaryNote, stored.contact], ["森田", 12, "winter-robata", 60000, "1名えびNG", { phone: "090-1234-5678" }]);
  const after = reserve.getState();
  assert.equal(after.version, 2);
  assert.equal(after.lastReservation.bookingId, receipt.bookingId);
  assert.deepEqual(after.form.times.find((slot: { time: string }) => slot.time === "19:00"), { time: "19:00", remaining: 2, fits: false }, "the page shows the seats that are left");
  assert.equal(document.getElementById("reserve-result").hidden, false);
  // The same call again is stale, and the seats are gone.
  assert.equal((await reserve.placeReservation(base)).field, "expectedVersion");
  assert.equal((await reserve.placeReservation({ ...base, expectedVersion: 2 })).ok, false);
  // The state an agent reads never carries another guest's details.
  assert.doesNotMatch(JSON.stringify(after), /デモのご予約|seed-guest|090-1234/);
});

test("seats only costs nothing, and a course-only restaurant refuses it in English too", async t => {
  const { seeded, page: reserve } = await page(t, "kanton-ryu", "en");
  const refused = await reserve.fillForm({ date: seeded.today, partySize: 4 });
  assert.deepEqual([refused.ok, refused.field, refused.reason], [false, "courseId", "This restaurant accepts reservations with a course only"]);
  assert.equal(reserve.getState().seatOnlyAllowed, false);
  assert.equal(reserve.getState().courses[0].priceText, "¥6,000 per person");
  const filled = await reserve.fillForm({ date: seeded.banquetDate, time: "17:30", partySize: 4, courseId: "veggie-table" });
  assert.deepEqual([filled.ok, filled.form.total, filled.form.totalText], [true, 20000, "¥20,000"]);
});

test("a reservation sent again after a lost answer is made once", async t => {
  const { store, seeded, page: reserve } = await page(t, "akari");
  const real = reserve.fetch;
  let lose = true;
  const sent: string[] = [];
  reserve.fetch = async (path: string, init?: RequestInit) => {
    const response = await real(path, init);
    if (init?.method !== "POST") return response;
    sent.push(JSON.parse(String(init.body)).requestId);
    // The server has made the reservation; the answer never arrives.
    if (lose) { lose = false; throw new TypeError("network down"); }
    return response;
  };
  const filled = await reserve.fillForm({ date: seeded.banquetDate, time: "18:00", partySize: 2 });
  const args = { date: seeded.banquetDate, time: "18:00", partySize: 2, name: "森田", phone: "03-1234-5678", expectedVersion: filled.version, expectedTotal: 0 };
  await assert.rejects(reserve.placeReservation(args), /network down/, "an unknown outcome is thrown, not reported as a refusal");
  const receipt = await reserve.placeReservation(args);
  assert.equal(receipt.ok, true);
  assert.equal(sent[0], sent[1], "the retry names the same request");
  const shop = (await store.list<import("../server/store.ts").Shop>("shop")).find(candidate => candidate.slug === "akari")!;
  assert.equal((await store.bookings(shop.id)).filter(booking => booking.name === "森田").length, 1);
  // A new reservation after a settled one is a new request.
  const next = await reserve.fillForm({ date: seeded.banquetDate, time: "18:00", partySize: 2 });
  assert.equal((await reserve.placeReservation({ ...args, expectedVersion: next.version })).ok, true);
  assert.notEqual(sent[2], sent[1]);
  assert.equal((await store.bookings(shop.id)).filter(booking => booking.name === "森田").length, 2);
});

test("unexpected authorization responses do not ask restaurant guests to register or sign in", async t => {
  const { seeded, page: reserve } = await page(t, "akari");
  const real = reserve.fetch;
  reserve.fetch = async (path: string, init?: RequestInit) => init?.method === "POST" ? new Response(JSON.stringify({ error: "先に会員情報を登録してください" }), { status: 428 }) : real(path, init);
  const filled = await reserve.fillForm({ date: seeded.banquetDate, time: "18:00", partySize: 2 });
  const refused = await reserve.placeReservation({ date: seeded.banquetDate, time: "18:00", partySize: 2, name: "森田", phone: "0312345678", expectedVersion: filled.version, expectedTotal: 0 });
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /再読み込み/);
  assert.doesNotMatch(refused.reason, /会員|ログイン/);
  reserve.fetch = async (path: string, init?: RequestInit) => init?.method === "POST" ? new Response("{}", { status: 401 }) : real(path, init);
  assert.match((await reserve.placeReservation({ date: seeded.banquetDate, time: "18:00", partySize: 2, name: "森田", phone: "0312345678", expectedVersion: filled.version, expectedTotal: 0 })).reason, /再読み込み/);
});

test("carried conditions survive a reload of the tab, such as the one saving an AI key makes", () => {
  const storage = fakeStorage();
  const carried = parseCarriedRequest("#aw=v1&date=2026-12-18&time=19:00&people=12&course=wanted&course_id=winter-robata&budget=5000&avoid=shrimp,甘えび");
  const now = Date.parse("2026-11-14T10:00:00Z");
  rememberRequest(storage, "akari", carried, now);
  assert.deepEqual(recallRequest(storage, "akari", now + 60000), carried, "the reload finds them again");
  assert.equal(recallRequest(storage, "trattoria-sole", now), null, "each shop keeps its own");
  assert.equal(recallRequest(storage, "akari", now + 3 * 60 * 60 * 1000), null, "stale conditions are dropped");
  assert.equal(storage.values.size, 0, "and forgotten");
  // Whatever is in storage passes the same checks as the address did.
  storage.setItem("gemihub:aw-request:akari", JSON.stringify({ savedAt: now, request: { date: "<script>", partySize: 999, name: "森田", email: "m@example.com", avoid: ["shrimp", "<b>"] } }));
  assert.deepEqual(recallRequest(storage, "akari", now), { course: "any", avoid: ["shrimp"] });
  storage.setItem("gemihub:aw-request:akari", "{not json");
  assert.equal(recallRequest(storage, "akari", now), null);
  forgetRequest(storage, "akari");
  // Storage that throws, as in some private windows, is ignored.
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  rememberRequest(blocked, "akari", carried, now);
  assert.equal(recallRequest(blocked, "akari", now), null);
  assert.equal(recallRequest(null, "akari", now), null);
});

test("a reservation made from carried conditions forgets them for the tab", async t => {
  const storage = fakeStorage();
  const { seeded, page: reserve } = await page(t, "akari", "ja", storage);
  rememberRequest(storage, "akari", { date: seeded.banquetDate, time: "18:00", partySize: 2, course: "none" });
  const filled = await reserve.fillForm({ date: seeded.banquetDate, time: "18:00", partySize: 2 });
  const refused = await reserve.placeReservation({ date: seeded.banquetDate, time: "18:00", partySize: 2, name: "", phone: "0312345678", expectedVersion: filled.version, expectedTotal: 0 });
  assert.equal(refused.ok, false);
  assert.equal(storage.values.size, 1, "a refusal keeps them");
  const receipt = await reserve.placeReservation({ date: seeded.banquetDate, time: "18:00", partySize: 2, name: "森田", phone: "0312345678", expectedVersion: filled.version, expectedTotal: 0 });
  assert.equal(receipt.ok, true);
  assert.equal(storage.values.size, 0);
});

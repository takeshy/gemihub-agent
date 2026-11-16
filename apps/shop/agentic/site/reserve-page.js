// The restaurant's reservation page. The form's own handlers and the assistant's actions
// (reservation-actions.js) call the same operations on ReservePage, so both follow one
// set of rules. The rules themselves live on the server: seats come from
// /api/public/<slug>/seats and a reservation is made by POST /api/public/<slug>/bookings.
import { openReviewDialog } from "./review-dialog.js";

const TEXT = {
  ja: {
    seatOnly: "席のみ",
    perPerson: "{0}/人",
    people: "{0}名",
    minutes: "{0}分",
    chooseTime: "時刻を選ぶ",
    left: "残り{0}席",
    full: "満席",
    summary: "{0} {1}〜（利用 {2}）／{3}／{4}／合計 {5}",
    summaryEmpty: "日付・人数・時刻を選ぶと、利用時間と合計が表示されます。",
    needDate: "日付を YYYY-MM-DD の形で指定してください",
    needTime: "開始時刻を HH:MM の形で指定してください",
    needPeople: "人数を指定してください",
    needName: "予約のお名前を入力してください",
    needPhone: "電話番号を入力してください",
    badPhone: "電話番号を確認してください",
    longNote: "食事の注記は300文字以内にしてください",
    longName: "お名前は100文字以内にしてください",
    badCourse: "このコースは予約できません",
    timeUnavailable: "この時刻は予約できません。別の時刻を選んでください",
    timeFull: "この時刻は満席です（残り{0}席）",
    stale: "ページの内容が変わりました。最新の内容を読み直してください",
    totalChanged: "合計が変わりました（現在 {0}）。内容を確認し直してください",
    formDiffers: "ページのフォームと予約内容が違います。先にフォームへ反映してください",
    network: "お店のサーバーに接続できませんでした",
    unknownOutcome: "予約できたかどうかを確認できませんでした。まだ失敗と決まったわけではありません。同じ内容のままもう一度「予約内容を確認する」を押すと、二重に予約されることなく結果を確認できます。",
    notAccepted: "予約を受け付けられませんでした。ページを再読み込みしてお試しください",
    tooMany: "短い時間に予約が続いたため、受け付けを一時的に止めています。少し時間をおいてお試しいただくか、お店へ直接ご連絡ください",
    done: "ご予約を承りました",
    receipt: "{0} {1}〜{2}／{3}／{4}／合計 {5}",
    cancelPolicy: "キャンセルは開始の{0}時間前までに、お店へ直接ご連絡ください。",
    callback: "ご予約後、お店から確認のお電話を差し上げます。",
    noCallback: "お店からの確認のお電話はありません。ご予約時刻から{0}分を過ぎてもご来店がない場合は、他のお客様をご案内します。",
    carried: "他のサイトから引き継いだ条件: {0}",
    carriedBudget: "予算 {0}/人",
    carriedAvoid: "避けたい食材 {0}",
    carriedCourse: { none: "席のみ", wanted: "コース希望", any: "コースはどちらでも" },
    continueMessage: "引き継いだ条件で予約を進めてください。",
    weekdays: ["日", "月", "火", "水", "木", "金", "土"],
    dialogTitle: "この内容で予約しますか？",
    dialogSentence: "下の内容で、お店に予約を入れます。",
    dialogConfirm: "この内容で予約する",
    dialogDecline: "やめる",
    labels: { when: "日時", duration: "利用時間", people: "人数", course: "コース", unit: "1人あたり", total: "合計", note: "食事の注記", name: "お名前", contact: "電話番号", confirmation: "ご予約の確認", cancel: "キャンセル" },
    payAtShop: "お支払いは当日お店で。",
  },
  en: {
    seatOnly: "Seats only",
    perPerson: "{0} per person",
    people: "{0} guests",
    minutes: "{0} min",
    chooseTime: "Choose a time",
    left: "{0} seats left",
    full: "full",
    summary: "{0} from {1} ({2}) / {3} / {4} / total {5}",
    summaryEmpty: "Choose a date, party size and time to see the length of stay and the total.",
    needDate: "Give the date as YYYY-MM-DD",
    needTime: "Give the start time as HH:MM",
    needPeople: "Give the number of guests",
    needName: "Enter the name for the reservation",
    needPhone: "Enter a phone number",
    badPhone: "Check the phone number",
    longNote: "Keep the dietary note within 300 characters",
    longName: "Keep the name within 100 characters",
    badCourse: "This course cannot be reserved",
    timeUnavailable: "This time cannot be reserved. Choose another time",
    timeFull: "This time is full ({0} seats left)",
    stale: "The page has changed. Read its current state again",
    totalChanged: "The total has changed (now {0}). Check the details again",
    formDiffers: "The form on the page differs from this reservation. Put it in the form first",
    network: "Could not reach the restaurant's server",
    unknownOutcome: "We could not confirm whether the reservation was made. It has not necessarily failed. Press \"Review the reservation\" again without changing anything: you will see the result, and it will not be reserved twice.",
    notAccepted: "The reservation could not be accepted. Reload the page and try again",
    tooMany: "Too many reservations were made in a short time, so we have paused them. Try again later or contact the restaurant directly",
    done: "Your reservation is confirmed",
    receipt: "{0} {1}-{2} / {3} / {4} / total {5}",
    cancelPolicy: "To cancel, contact the restaurant at least {0} hours before the start.",
    callback: "After you reserve, the restaurant will call you to confirm.",
    noCallback: "The restaurant will not call to confirm. If you have not arrived {0} minutes after your reservation time, your seats go to other guests.",
    carried: "Conditions carried over from another site: {0}",
    carriedBudget: "budget {0} per person",
    carriedAvoid: "avoid {0}",
    carriedCourse: { none: "seats only", wanted: "course wanted", any: "course or seats" },
    continueMessage: "Continue the reservation with the conditions carried over.",
    weekdays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    dialogTitle: "Make this reservation?",
    dialogSentence: "We will reserve with the restaurant as shown below.",
    dialogConfirm: "Reserve",
    dialogDecline: "Don't reserve",
    labels: { when: "When", duration: "Length of stay", people: "Guests", course: "Course", unit: "Per person", total: "Total", note: "Dietary note", name: "Name", contact: "Phone", confirmation: "Confirmation", cancel: "Cancellation" },
    payAtShop: "Pay at the restaurant on the day.",
  },
};
const ALLERGENS = ["egg", "milk", "wheat", "buckwheat", "peanut", "shrimp", "crab", "walnut"];
// Mirrors lateReleaseMinutes in shared/seating.ts.
const LATE_RELEASE_MINUTES = 5;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const fill = (text, ...values) => text.replace(/\{(\d)\}/g, (_, index) => String(values[Number(index)] ?? ""));

/**
 * Read the conditions another site passed in the URL fragment (#aw=v1&date=...).
 * Only conditions travel this way: no names, contacts or keys. Anything malformed is dropped.
 *
 * :param hash: location.hash, with or without the leading "#".
 * :return: The accepted conditions, or null when the fragment carries none.
 */
export function parseCarriedRequest(hash) {
  const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  if (params.get("aw") !== "v1") {
    return null;
  }
  const request = {};
  const date = params.get("date") || "";
  if (DATE.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    request.date = date;
  }
  const time = params.get("time") || "";
  if (TIME.test(time)) {
    request.time = time;
  }
  const people = Number(params.get("people"));
  if (Number.isInteger(people) && people >= 1 && people <= 200) {
    request.partySize = people;
  }
  const course = params.get("course") || "any";
  request.course = ["none", "wanted", "any"].includes(course) ? course : "any";
  const courseId = params.get("course_id") || "";
  if (/^[a-z0-9_-]{1,60}$/.test(courseId)) {
    request.courseId = courseId;
  }
  const budget = Number(params.get("budget"));
  if (Number.isInteger(budget) && budget >= 1 && budget <= 1000000) {
    request.budgetPerPerson = budget;
  }
  // The eight labelled allergens by id, plus up to five short free words.
  const avoid = [];
  let free = 0;
  for (const raw of params.getAll("avoid").flatMap((value) => value.split(","))) {
    const word = raw.trim();
    if (!word || avoid.includes(word)) {
      continue;
    }
    if (ALLERGENS.includes(word)) {
      avoid.push(word);
    } else if (free < 5 && word.length <= 20 && !/[<>"'`&\\]/.test(word)) {
      avoid.push(word);
      free += 1;
    }
  }
  if (avoid.length) {
    request.avoid = avoid;
  }
  return request;
}

/** How long carried conditions survive reloads of the tab, such as the one "Save and start" makes. */
const REQUEST_TTL_MS = 2 * 60 * 60 * 1000;
const requestKey = (slug) => `gemihub:aw-request:${slug}`;

/**
 * Keep the carried conditions for this tab, so a reload does not lose them. sessionStorage is
 * per tab and per origin, and only conditions are kept: no names, contacts or keys.
 * Storage that is missing or refuses is ignored; the conditions then last until a reload.
 */
export function rememberRequest(storage, slug, request, now = Date.now()) {
  try {
    storage?.setItem(requestKey(slug), JSON.stringify({ savedAt: now, request: request }));
  } catch {
    // Private windows and blocked storage: nothing to keep.
  }
}

/** The conditions kept for this tab, checked again as if they had just arrived, or null. */
export function recallRequest(storage, slug, now = Date.now()) {
  try {
    const saved = JSON.parse(storage?.getItem(requestKey(slug)) || "null");
    if (!saved || typeof saved.savedAt !== "number" || now - saved.savedAt > REQUEST_TTL_MS || now < saved.savedAt) {
      forgetRequest(storage, slug);
      return null;
    }
    // Stored values pass the same checks as the address did, so nothing else can be planted here.
    const params = new URLSearchParams({ aw: "v1" });
    for (const [key, value] of Object.entries({ date: saved.request?.date, time: saved.request?.time, people: saved.request?.partySize, course: saved.request?.course, course_id: saved.request?.courseId, budget: saved.request?.budgetPerPerson })) {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }
    if (Array.isArray(saved.request?.avoid)) {
      params.set("avoid", saved.request.avoid.map(String).join(","));
    }
    return parseCarriedRequest(params.toString());
  } catch {
    return null;
  }
}

export function forgetRequest(storage, slug) {
  try {
    storage?.removeItem(requestKey(slug));
  } catch {
    // Nothing was kept.
  }
}

/**
 * The reservation page: its form, the seats it shows, and the operations on them.
 */
export class ReservePage {
  /**
   * :param options: slug, the shop's public config, the display language, and optional
   *   fetch, document, location, history and clock stand-ins for tests.
   */
  constructor(options) {
    this.slug = options.slug;
    this.config = options.config;
    this.lang = options.lang === "en" ? "en" : "ja";
    this.t = TEXT[this.lang];
    this.fetch = options.fetch || globalThis.fetch.bind(globalThis);
    this.document = options.document || globalThis.document;
    this.now = options.now || (() => new Date());
    this.form = { date: "", time: "", partySize: null, courseId: "", dietaryNote: "" };
    this.version = 0;
    this.slots = [];
    this.durationMinutes = null;
    this.lastReservation = null;
    this.request = options.request || null;
    this.storage = options.storage || null;
    this.pending = Promise.resolve();
    this.request_ = null;
    this.api = `/api/public/${encodeURIComponent(this.slug)}`;
  }

  get timeZone() {
    return this.config.region?.timeZone || "Asia/Tokyo";
  }

  get currency() {
    return this.config.region?.country === "US" ? "USD" : "JPY";
  }

  courses() {
    return this.config.menus.filter((menu) => menu.active && menu.kind === "course" && !menu.optionFor);
  }

  courseIds() {
    return this.courses().map((course) => course.id);
  }

  money(amount) {
    if (this.currency === "JPY") {
      return this.lang === "ja" ? `${amount.toLocaleString("en-US")}円` : `¥${amount.toLocaleString("en-US")}`;
    }
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
  }

  today() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: this.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(this.now());
  }

  addDays(date, days) {
    return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  }

  /** A date with its weekday, such as "2026-12-18（金）" or "Fri, Dec 18, 2026". */
  dateText(date) {
    const day = new Date(`${date}T00:00:00Z`);
    if (this.lang === "ja") {
      return `${date}（${this.t.weekdays[day.getUTCDay()]}）`;
    }
    return day.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }

  /** The wall-clock time of an instant in the shop's time zone, as HH:MM. */
  clock(instant) {
    return new Intl.DateTimeFormat("en-GB", { timeZone: this.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(instant));
  }

  total(partySize, courseId) {
    const course = this.courses().find((item) => item.id === courseId);
    return course && partySize ? Math.round(course.price * partySize * 100) / 100 : 0;
  }

  courseName(courseId) {
    return this.courses().find((item) => item.id === courseId)?.name || this.t.seatOnly;
  }

  /**
   * The page's state as plain data: what can be reserved and what the form shows now.
   * Dates are worked out from the clock on each read, since the page may stay open overnight.
   */
  getState() {
    const today = this.today();
    const first = this.config.rules.sameDay ? today : this.addDays(today, 1);
    const last = this.addDays(today, this.config.rules.advanceDays);
    const seating = this.config.seating;
    const form = this.form;
    const total = this.total(form.partySize, form.courseId);
    return {
      shop: this.config.name,
      today: today,
      todayText: this.dateText(today),
      firstDate: first,
      firstDateText: this.dateText(first),
      lastDate: last,
      lastDateText: this.dateText(last),
      partySize: { min: seating.minPartySize, max: seating.maxPartySize },
      largePartyFrom: seating.largePartyFrom,
      seatOnlyAllowed: seating.seatOnly,
      startTimes: [...seating.startTimes].sort(),
      courses: this.courses().map((course) => ({
        id: course.id,
        name: course.name,
        priceText: fill(this.t.perPerson, this.money(course.price)),
        minPeople: course.minPeople ?? null,
        maxPeople: course.maxPeople ?? null,
      })),
      cancellation: fill(this.t.cancelPolicy, this.config.rules.cancelHours),
      confirmation: this.confirmationText(),
      payment: this.t.payAtShop,
      form: {
        date: form.date || null,
        dateText: form.date ? this.dateText(form.date) : null,
        time: form.time || null,
        partySize: form.partySize,
        courseId: form.courseId || null,
        course: form.partySize ? this.courseName(form.courseId) : null,
        seatOnly: !form.courseId,
        durationMinutes: this.durationMinutes,
        dietaryNote: form.dietaryNote,
        total: total,
        totalText: this.money(total),
        times: this.slots.map((slot) => ({ time: this.clock(slot.start), remaining: slot.remaining, fits: slot.fits })),
      },
      version: this.version,
      lastReservation: this.lastReservation,
    };
  }

  /** The conditions carried over from another site, or null. */
  getRequest() {
    return this.request ? structuredClone(this.request) : null;
  }

  /**
   * Ask the server which start times this party can have. Changes nothing.
   *
   * :return: {ok: true, durationMinutes, slots} or {ok: false, reason, field}.
   */
  async seats(date, partySize, courseId) {
    const query = new URLSearchParams({ date: date, people: String(partySize) });
    if (courseId) {
      query.set("course", courseId);
    }
    let response;
    try {
      response = await this.fetch(`${this.api}/seats?${query}`, { headers: { Accept: "application/json" } });
    } catch {
      return { ok: false, reason: this.t.network, field: "date" };
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, reason: data.error || this.t.network, field: "date" };
    }
    if (data.problem) {
      const field = { party_size: "partySize", seat_only: "courseId", course: "courseId", course_people: "partySize" }[data.problem] || "date";
      return { ok: false, reason: data.reason, field: field };
    }
    return { ok: true, durationMinutes: data.durationMinutes, slots: data.slots };
  }

  /** Check the shape of the reservation's own fields, before asking the server. */
  checkShape(args) {
    if (!DATE.test(String(args.date || ""))) {
      return { ok: false, reason: this.t.needDate, field: "date" };
    }
    if (!Number.isInteger(args.partySize) || args.partySize < 1) {
      return { ok: false, reason: this.t.needPeople, field: "partySize" };
    }
    if (args.time !== undefined && args.time !== "" && !TIME.test(String(args.time))) {
      return { ok: false, reason: this.t.needTime, field: "time" };
    }
    if (args.courseId && !this.courseIds().includes(args.courseId)) {
      return { ok: false, reason: this.t.badCourse, field: "courseId" };
    }
    if (String(args.dietaryNote || "").trim().length > 300) {
      return { ok: false, reason: this.t.longNote, field: "dietaryNote" };
    }
    return { ok: true };
  }

  /**
   * Whether this party can have this time: the read-only check behind the form and the reservation.
   *
   * :return: {ok: true, durationMinutes, slots, slot} or {ok: false, reason, field}.
   */
  async checkSeat(args) {
    const shape = this.checkShape(args);
    if (!shape.ok) {
      return shape;
    }
    const seats = await this.seats(args.date, args.partySize, args.courseId || "");
    if (!seats.ok || !args.time) {
      return seats;
    }
    const slot = seats.slots.find((item) => this.clock(item.start) === args.time);
    if (!slot) {
      return { ok: false, reason: this.t.timeUnavailable, field: "time" };
    }
    if (!slot.fits) {
      return { ok: false, reason: fill(this.t.timeFull, slot.remaining), field: "time" };
    }
    return { ...seats, slot: slot };
  }

  /**
   * Put a date, party size, course, time and dietary note in the form. Refuses, without
   * changing the form, what the restaurant cannot seat.
   *
   * :param args: date, partySize, and optional time, courseId (absent means seats only) and dietaryNote.
   * :return: The updated form with the new version, or {ok: false, reason, field}.
   */
  async fillForm(args) {
    const check = await this.checkSeat(args);
    if (!check.ok) {
      return check;
    }
    this.form = {
      date: args.date,
      time: args.time || "",
      partySize: args.partySize,
      courseId: args.courseId || "",
      dietaryNote: args.dietaryNote === undefined ? this.form.dietaryNote : String(args.dietaryNote).trim(),
    };
    this.slots = check.slots;
    this.durationMinutes = check.durationMinutes;
    this.version += 1;
    this.showError("");
    this.render();
    const state = this.getState();
    return { ok: true, form: state.form, version: state.version };
  }

  /**
   * The whole check of a reservation, changing nothing: the guest's details, the page
   * version, the total they saw, and the seats.
   *
   * :return: {ok: true, ...what the confirmation shows} or {ok: false, reason, field}.
   */
  async checkReservation(args) {
    const name = String(args.name || "").trim();
    const phone = String(args.phone || "").trim();
    if (!name) {
      return { ok: false, reason: this.t.needName, field: "name" };
    }
    if (name.length > 100) {
      return { ok: false, reason: this.t.longName, field: "name" };
    }
    if (!phone) {
      return { ok: false, reason: this.t.needPhone, field: "phone" };
    }
    if (!/^[0-9+() -]{6,24}$/.test(phone) || phone.replace(/\D/g, "").length < 6) {
      return { ok: false, reason: this.t.badPhone, field: "phone" };
    }
    if (!TIME.test(String(args.time || ""))) {
      return { ok: false, reason: this.t.needTime, field: "time" };
    }
    if (args.expectedVersion !== this.version) {
      return { ok: false, reason: this.t.stale, field: "expectedVersion" };
    }
    const form = this.form;
    if (form.date !== args.date || form.time !== args.time || form.partySize !== args.partySize || form.courseId !== (args.courseId || "")) {
      return { ok: false, reason: this.t.formDiffers, field: "date" };
    }
    const seat = await this.checkSeat(args);
    if (!seat.ok) {
      return seat;
    }
    const total = this.total(args.partySize, args.courseId || "");
    if (args.expectedTotal !== total) {
      return { ok: false, reason: fill(this.t.totalChanged, this.money(total)), field: "expectedTotal" };
    }
    const course = this.courses().find((item) => item.id === args.courseId);
    return {
      ok: true,
      name: name,
      phone: phone,
      dietaryNote: String(args.dietaryNote ?? form.dietaryNote ?? "").trim(),
      start: seat.slot.start,
      end: seat.slot.end,
      durationMinutes: seat.durationMinutes,
      course: this.courseName(args.courseId || ""),
      unitText: course ? fill(this.t.perPerson, this.money(course.price)) : null,
      total: total,
      totalText: this.money(total),
    };
  }

  /**
   * What the confirmation dialog shows for a reservation, by label, or {refusal: reason}.
   */
  async reviewDetails(args) {
    const check = await this.checkReservation(args);
    if (!check.ok) {
      return { refusal: check.reason };
    }
    const labels = this.t.labels;
    const details = {
      [labels.when]: `${this.dateText(args.date)} ${args.time}`,
      [labels.duration]: fill(this.t.minutes, check.durationMinutes),
      [labels.people]: fill(this.t.people, args.partySize),
      [labels.course]: check.course,
    };
    if (check.unitText) {
      details[labels.unit] = check.unitText;
    }
    details[labels.total] = `${check.totalText} (${this.t.payAtShop})`;
    if (check.dietaryNote) {
      details[labels.note] = check.dietaryNote;
    }
    details[labels.name] = check.name;
    details[labels.contact] = check.phone;
    details[labels.confirmation] = this.confirmationText();
    details[labels.cancel] = fill(this.t.cancelPolicy, this.config.rules.cancelHours);
    return details;
  }

  /** How the guest hears back: a call from the restaurant, or no call and seats given up when they are late. */
  confirmationText() {
    return this.config.seating.confirmationCall === false ? fill(this.t.noCallback, LATE_RELEASE_MINUTES) : this.t.callback;
  }

  /** The dialog's words, shared by the page's own button and the assistant. */
  dialogWords() {
    return { title: this.t.dialogTitle, sentence: this.t.dialogSentence, confirm: this.t.dialogConfirm, decline: this.t.dialogDecline };
  }

  /**
   * Make the reservation the visitor confirmed.
   *
   * :param args: date, time, partySize, optional courseId and dietaryNote, name, phone,
   *   expectedVersion and expectedTotal.
   * :return: The receipt, or {ok: false, reason, field} when the restaurant refuses.
   * :raises Error: Only when the request was sent and its outcome is not known.
   */
  async placeReservation(args) {
    const check = await this.checkReservation(args);
    if (!check.ok) {
      return check;
    }
    const body = {
      name: check.name,
      date: args.date,
      time: args.time,
      partySize: args.partySize,
      dietaryNote: check.dietaryNote,
      expectedTotal: check.total,
    };
    if (args.courseId) {
      body.courseId = args.courseId;
    }
    body.phone = check.phone;
    // The same reservation sent again carries the same request id, so a retry after a lost answer
    // returns the reservation already made instead of taking the seats twice.
    const fingerprint = JSON.stringify(body);
    if (this.request_?.fingerprint !== fingerprint) {
      this.request_ = { fingerprint: fingerprint, id: globalThis.crypto.randomUUID() };
    }
    body.requestId = this.request_.id;
    // From here the request may reach the server: a failure to read the answer is an unknown outcome.
    const response = await this.fetch(`${this.api}/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (response.status < 500) {
      // The server answered: this request is settled, and a later reservation is a new one.
      this.request_ = null;
    }
    if (response.status === 401 || response.status === 403 || response.status === 428) {
      return { ok: false, reason: this.t.notAccepted, field: "name" };
    }
    if (response.status === 429) {
      return { ok: false, reason: data?.error || this.t.tooMany, field: "phone" };
    }
    if (response.status >= 400 && response.status < 500) {
      return { ok: false, reason: data?.error || this.t.timeUnavailable, field: "time" };
    }
    if (!response.ok || !data?.booking) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    const booking = data.booking;
    // The carried conditions have done their job; a later visit in this tab starts fresh.
    forgetRequest(this.storage, this.slug);
    this.lastReservation = {
      bookingId: booking.id,
      date: args.date,
      start: this.clock(booking.start),
      end: this.clock(booking.end),
      partySize: booking.partySize,
      course: this.courseName(booking.courseId || ""),
      totalText: this.money(booking.price),
      confirmation: this.confirmationText(),
    };
    this.version += 1;
    this.showError("");
    await this.refreshTimes();
    this.render();
    return { ok: true, ...this.lastReservation };
  }

  /** Read the seats for the form's date, party size and course again, keeping the form. */
  async refreshTimes() {
    const form = this.form;
    if (!form.date || !form.partySize) {
      this.slots = [];
      this.durationMinutes = null;
      return;
    }
    const seats = await this.seats(form.date, form.partySize, form.courseId);
    this.slots = seats.ok ? seats.slots : [];
    this.durationMinutes = seats.ok ? seats.durationMinutes : null;
  }

  element(id) {
    return this.document.getElementById(id);
  }

  showError(message) {
    const box = this.element("reserve-error");
    box.textContent = message;
    box.hidden = !message;
  }

  /** Draw the form, the summary and the latest reservation from the page's state. */
  render() {
    const state = this.getState();
    const form = state.form;
    const date = this.element("reserve-date");
    date.min = state.firstDate;
    date.max = state.lastDate;
    date.value = form.date || "";
    const people = this.element("reserve-people");
    people.min = String(state.partySize.min);
    people.max = String(state.partySize.max);
    people.value = form.partySize ? String(form.partySize) : "";
    const course = this.element("reserve-course");
    const courseOptions = [];
    if (state.seatOnlyAllowed) {
      courseOptions.push(["", this.t.seatOnly]);
    }
    for (const item of state.courses) {
      courseOptions.push([item.id, `${item.name} (${item.priceText})`]);
    }
    this.setOptions(course, courseOptions, form.courseId || "");
    const time = this.element("reserve-time");
    const timeOptions = [["", this.t.chooseTime]];
    for (const slot of form.times) {
      timeOptions.push([slot.time, `${slot.time} (${slot.fits ? fill(this.t.left, slot.remaining) : this.t.full})`, !slot.fits]);
    }
    this.setOptions(time, timeOptions, form.time || "");
    this.element("reserve-note").value = form.dietaryNote;
    this.element("reserve-summary").textContent = form.date && form.time && form.partySize
      ? fill(this.t.summary, form.dateText, form.time, fill(this.t.minutes, form.durationMinutes), fill(this.t.people, form.partySize), form.course, form.totalText)
      : this.t.summaryEmpty;
    const result = this.element("reserve-result");
    const last = state.lastReservation;
    result.hidden = !last;
    if (last) {
      this.element("reserve-result-title").textContent = this.t.done;
      this.element("reserve-result-text").textContent = fill(this.t.receipt, this.dateText(last.date), last.start, last.end, fill(this.t.people, last.partySize), last.course, last.totalText) + " " + last.confirmation;
    }
    const carried = this.element("reserve-carried");
    if (carried) carried.hidden = !this.request;
    if (carried && this.request) {
      this.element("reserve-carried-text").textContent = fill(this.t.carried, this.requestText());
    }
  }

  setOptions(select, options, value) {
    select.replaceChildren(...options.map(([optionValue, label, disabled]) => {
      const option = this.document.createElement("option");
      option.value = optionValue;
      option.textContent = label;
      option.disabled = !!disabled;
      return option;
    }));
    select.value = value;
  }

  /** The carried-over conditions as one readable line. */
  requestText() {
    const request = this.request;
    const parts = [];
    if (request.date) {
      parts.push(`${this.dateText(request.date)}${request.time ? ` ${request.time}` : ""}`);
    }
    if (request.partySize) {
      parts.push(fill(this.t.people, request.partySize));
    }
    parts.push(request.courseId ? this.courseName(request.courseId) : this.t.carriedCourse[request.course]);
    if (request.budgetPerPerson) {
      parts.push(fill(this.t.carriedBudget, this.money(request.budgetPerPerson)));
    }
    if (request.avoid) {
      parts.push(fill(this.t.carriedAvoid, request.avoid.join(", ")));
    }
    return parts.join(" / ");
  }

  /** What the form's fields hold now, as the arguments of fillForm. */
  readFields() {
    const people = Number(this.element("reserve-people").value);
    return {
      date: this.element("reserve-date").value,
      time: this.element("reserve-time").value,
      partySize: Number.isInteger(people) && people > 0 ? people : null,
      courseId: this.element("reserve-course").value,
      dietaryNote: this.element("reserve-note").value,
    };
  }

  /** The visitor changed a field: apply it through the same operation the assistant uses. */
  onFieldChange(changed) {
    // One change at a time, in order, so the reserve button never acts on a half-applied form.
    this.pending = this.pending.then(() => this.applyFields(changed)).catch((error) => console.error(error));
    return this.pending;
  }

  /** Apply the form's fields through the same operation the assistant uses. */
  async applyFields(changed) {
    const fields = this.readFields();
    if (!fields.date || !fields.partySize) {
      // Not enough to ask about seats yet; keep what was typed.
      this.form = { ...this.form, ...fields, time: "" };
      this.slots = [];
      this.version += 1;
      return;
    }
    // Keep the chosen time when the new date, party size or course still offers it.
    let result = await this.fillForm(fields);
    if (!result.ok && result.field === "time" && changed !== "time") {
      result = await this.fillForm({ ...fields, time: "" });
    }
    if (!result.ok) {
      this.showError(result.reason);
    }
  }

  /** The visitor pressed the page's own reserve button. */
  async onSubmit(event) {
    event.preventDefault();
    // Leaving a field to press the button changes it first; wait for that, then apply anything still unapplied.
    await this.pending;
    const fields = this.readFields();
    const form = this.form;
    if (fields.date && fields.partySize && (fields.date !== form.date || fields.time !== form.time || fields.partySize !== form.partySize || fields.courseId !== form.courseId || fields.dietaryNote.trim() !== form.dietaryNote)) {
      const applied = await this.fillForm(fields);
      if (!applied.ok) {
        this.showError(applied.reason);
        return;
      }
    }
    const args = {
      date: fields.date,
      time: fields.time,
      partySize: fields.partySize,
      dietaryNote: fields.dietaryNote,
      name: this.element("reserve-name").value,
      phone: this.element("reserve-phone").value,
      expectedVersion: this.version,
      expectedTotal: this.total(fields.partySize, fields.courseId),
    };
    if (fields.courseId) {
      args.courseId = fields.courseId;
    }
    const details = await this.reviewDetails(args);
    if (details.refusal) {
      this.showError(details.refusal);
      return;
    }
    const confirmed = await openReviewDialog(this.document, { ...this.dialogWords(), details: details, exact: "" });
    if (!confirmed) {
      return;
    }
    try {
      const receipt = await this.placeReservation(args);
      if (!receipt.ok) {
        this.showError(receipt.reason);
      } else {
        this.element("reserve-result").scrollIntoView?.({ block: "start", behavior: "smooth" });
      }
    } catch {
      // The request may have reached the server. Say so, and point to the safe way to find out.
      this.showError(this.t.unknownOutcome);
    }
  }

  /** Connect the form's own controls and draw the page. */
  async start() {
    for (const [id, name] of [["reserve-date", "date"], ["reserve-people", "partySize"], ["reserve-course", "courseId"], ["reserve-time", "time"], ["reserve-note", "dietaryNote"]]) {
      this.element(id).addEventListener("change", this.onFieldChange.bind(this, name));
    }
    this.element("reserve-form").addEventListener("submit", this.onSubmit.bind(this));
    this.element("reserve-continue")?.addEventListener("click", this.continueInChat.bind(this));
    this.render();
    // Conditions from another site go into the form at once, so the page works without the assistant.
    const request = this.request;
    if (request?.date && request.partySize) {
      const courseId = request.courseId && this.courseIds().includes(request.courseId) ? request.courseId : "";
      const base = { date: request.date, partySize: request.partySize, courseId: courseId };
      const result = await this.fillForm({ ...base, time: request.time || "" });
      if (!result.ok) {
        const retry = await this.fillForm(base);
        this.showError(result.reason);
        if (!retry.ok) {
          this.render();
        }
      }
    }
  }

  /** Send the standard first message to the assistant; the visitor's click starts the turn. */
  continueInChat() {
    if (this.document.getElementById("assistant")?.hidden) {
      this.document.getElementById("assistant-toggle")?.click();
    }
    const input = this.document.getElementById("ns-input");
    const send = this.document.getElementById("ns-send");
    if (!input || !send) {
      return;
    }
    input.value = `${this.t.continueMessage}\n${this.requestText()}`;
    send.click();
    input.focus?.();
  }
}

/**
 * Holds the one page object that the form, site.js and the actions module share.
 */
export class App {
  static page = null;

  /** Whether the finder site is showing this page in a frame beside its own chat. */
  static embedded() {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  }

  /**
   * This page's own assistant runs in the frame on the visitor's AI, relayed by the finder
   * site (site.js). The finder is told that the page has loaded, so it can offer another tab
   * when a frame is refused.
   */
  static announceEmbedded() {
    if (!App.embedded()) {
      return;
    }
    document.documentElement.dataset.embedded = "true";
    for (const id of ["assistant-key-note", "assistant-privacy-note"]) {
      const element = document.getElementById(id);
      if (element) {
        element.hidden = true;
      }
    }
    const note = document.getElementById("reserve-embedded-note");
    if (note) {
      note.hidden = false;
    }
    const parentOrigin = document.documentElement.dataset.parentOrigin;
    if (parentOrigin) {
      // Addressed to the registered finder alone; it carries no key, name or reservation.
      window.parent.postMessage({ type: "gemihub:reserve-ready", version: 1, shop: App.page?.slug || document.documentElement.dataset.slug }, parentOrigin);
    }
  }

  /** Load the shop's public settings and start the page. */
  static async start() {
    // The worker controls /s/<slug>/ and its descendants. Navigation in older
    // published headers can still point at the home URL without its final slash.
    const shopBase = document.getElementById("root")?.dataset.shopBase || new URL("../", import.meta.url).pathname.replace(/\/$/, "");
    if (App.embedded() && shopBase && location.pathname === shopBase) {
      location.replace(`${shopBase}/${location.search}${location.hash}`);
      return null;
    }
    // Information-only guides have no reservation form or public booking API to load.
    if (document.documentElement.dataset.agentKind === "shop") {
      App.announceEmbedded();
      return null;
    }
    // The server names the shop; under /s/<slug>/reserve the address says the same.
    const slug = document.documentElement.dataset.slug || decodeURIComponent(location.pathname.split("/")[2] || "");
    const lang = document.documentElement.lang;
    const response = await fetch(`/api/public/${encodeURIComponent(slug)}`, { headers: { Accept: "application/json", "X-Gemihub-Language": lang } });
    if (!response.ok) {
      throw new Error(`Could not load the shop (${response.status})`);
    }
    const data = await response.json();
    let storage = null;
    try {
      storage = window.sessionStorage;
    } catch {
      // Blocked storage: the conditions last until the next reload.
    }
    let request = parseCarriedRequest(location.hash);
    if (request) {
      // The conditions leave the address bar, history and referrer at once, but stay with this tab:
      // saving an AI key reloads the page, and the visitor must not have to come back for them.
      rememberRequest(storage, slug, request);
      history.replaceState(null, "", location.pathname + location.search);
    } else {
      request = recallRequest(storage, slug);
    }
    App.page = new ReservePage({ slug: slug, config: data.config, lang: lang, request: request, storage: storage });
    await App.page.start();
    App.announceEmbedded();
    return App.page;
  }
}

// Start only in a browser. Node tests build ReservePage with stand-ins.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  await App.start().catch((error) => {
    console.error("The reservation page could not start", error);
    const box = document.getElementById("reserve-error");
    if (box) {
      box.textContent = TEXT[document.documentElement.lang === "en" ? "en" : "ja"].network;
      box.hidden = false;
    }
  });
}

import { allergenLabel, COURSE_LABELS } from "./finder.js";

// Approval belongs to one search and its exact destinations, never an entire host
// forever. The runtime remains responsible for fetching and executing the peers.
export class ShopInquiries {
  constructor(getPage, review, getUserMessage = () => "") {
    this.getPage = getPage;
    this.review = review;
    this.getUserMessage = getUserMessage;
    this.preferences = { cuisine: null, area: null };
    this.approved = null;
    this.pending = null;
  }

  invalidate() {
    this.approved = null;
    this.pending?.abort();
  }

  reset() {
    this.invalidate();
    this.preferences = { cuisine: null, area: null };
  }

  async confirm({ cuisine, area, expectedVersion } = {}) {
    if (this.pending) return { ok: false, reason: "問い合わせ先の確認に回答してください。" };
    const page = this.getPage();
    const state = page.getState();
    if (expectedVersion !== state.version || !state.valid) return { ok: false, reason: "最新の日時・人数を確認してください。" };
    if (![cuisine, area].every(value => typeof value === "string" && value.length <= 80)) {
      return { ok: false, reason: "希望のジャンルと場所を聞いてください。指定なしの場合は空文字を使ってください。" };
    }
    this.approved = null;
    const text = this.getUserMessage().normalize("NFKC").replace(/\s/g, "");
    const any = /^(おまかせ|指定なし)(で|です|お願いします|でお願いします|でいいです|で良いです)?[。.!！]*$/.test(text)
      || /^(?:おまかせ[・、,/]?どこでも|どこでも[・、,/]?おまかせ)(?:で(?:す|お願いします|いいです|良いです)|いいです|良いです)?[。.!！]*$/.test(text);
    const unrestricted = field => any || new RegExp(`${field === "cuisine" ? "(?:ジャンル|料理|食事)" : "(?:場所|地域|エリア)"}.{0,12}(?:指定なし|おまかせ|何でも|なんでも|どこでも|問わない|こだわり.{0,3}(?:ない|なし|ありません))`).test(text);
    const resolve = (field, value) => value.trim() || (unrestricted(field) ? "" : this.preferences[field]);
    const preferences = { cuisine: resolve("cuisine", cuisine), area: resolve("area", area) };
    if (Object.values(preferences).some(value => value === null)) {
      return { ok: false, reason: "希望のジャンルと場所を先にチャットで聞き、返答を待ってください。未確認を指定なしにしないでください。" };
    }
    this.preferences = preferences;
    page.clearCandidates();
    const shops = page.listShops(this.preferences);
    if (!shops.length) return { ok: false, count: 0, reason: "そのジャンル・場所に合う登録店はありません。希望を変えるか確認してください。" };
    if (shops.length > 4) return { ok: false, count: shops.length, reason: "一度に問い合わせられるのは4店です。ジャンルや場所で絞ってください。" };
    const plan = { ...this.preferences, expectedVersion, conditions: state.conditions, shops, count: shops.length };
    const controller = new AbortController();
    this.pending = controller;
    try {
      const accepted = await this.review(plan, controller.signal);
      if (controller.signal.aborted || this.getPage().version !== expectedVersion) {
        return { ok: false, reason: "条件が変わりました。問い合わせ先を確認し直してください。" };
      }
      if (accepted !== true) return { ok: true, approved: false, count: plan.count, reason: "問い合わせは行っていません。希望を確認してください。" };
      this.approved = plan;
      return { ok: true, approved: true, count: plan.count, shops, version: expectedVersion };
    } finally {
      if (this.pending === controller) this.pending = null;
    }
  }

  activePlan() {
    return this.approved?.expectedVersion === this.getPage().version ? this.approved : null;
  }

  canContactNetwork(url) {
    return this.activePlan()?.shops.some(shop => shop.networkUrl === url) || false;
  }

  canContactMcp(ref) {
    try {
      const url = new URL(typeof ref === "string" ? ref : ref.url);
      return this.activePlan()?.shops.some(shop => new URL(shop.networkUrl).origin === url.origin) || false;
    } catch { return false; }
  }

  decision(info) {
    if (!["network", "mcp"].includes(info.kind)) return "decline";
    return this.activePlan()?.shops.some(shop => new URL(shop.networkUrl).host === info.peerOrigin) ? "allow" : "decline";
  }
}

export function installInquiryPolicy(engine, inquiries) {
  engine.consent.clear();
  engine.onConsent = info => inquiries.decision(info);
  const resolveRemote = engine.resolveRemote.bind(engine);
  engine.resolveRemote = (url, ...args) => {
    if (!inquiries.canContactNetwork(url)) throw new Error("先にジャンル・場所と問い合わせ先の件数を確認してください。");
    return resolveRemote(url, ...args);
  };
  const resolveMcp = engine.resolveMcp.bind(engine);
  engine.resolveMcp = (ref, ...args) => {
    if (!inquiries.canContactMcp(ref)) throw new Error("確認した問い合わせ先に含まれない接続先です。");
    return resolveMcp(ref, ...args);
  };
}

export function reviewShopInquiries(plan, signal) {
  return new Promise(resolve => {
    const messages = document.getElementById("ns-msgs");
    const card = document.createElement("div");
    card.className = "ns-msg bot finder-inquiry";
    card.setAttribute("role", "group");
    card.setAttribute("aria-label", "問い合わせ先の確認");
    const title = document.createElement("p");
    title.className = "finder-inquiry-title";
    title.textContent = `この条件だと${plan.count}店に問い合わせます。問い合わせますか？`;
    const summary = document.createElement("p");
    const c = plan.conditions;
    summary.textContent = `${plan.cuisine || "ジャンル指定なし"} / ${plan.area || "場所指定なし"} · ${c.date} ${c.time} / ${c.partySize}名 / ${COURSE_LABELS[c.course]}`
      + (c.budgetPerPerson ? ` / 1人${c.budgetPerPerson.toLocaleString("ja-JP")}円` : "")
      + (c.avoid.length ? ` / 避けたい食材：${c.avoid.map(allergenLabel).join("、")}` : "");
    const targets = document.createElement("p");
    targets.textContent = plan.shops.map(shop => shop.name).join("、");
    const origins = document.createElement("small");
    origins.textContent = [...new Set(plan.shops.map(shop => new URL(shop.networkUrl).origin))].join("、");
    const buttons = document.createElement("div");
    buttons.className = "finder-inquiry-actions";
    const yes = document.createElement("button");
    yes.type = "button"; yes.textContent = "問い合わせる";
    const no = document.createElement("button");
    no.type = "button"; no.textContent = "条件を変える";
    const finish = accepted => {
      signal.removeEventListener("abort", abort);
      buttons.remove();
      title.textContent = signal.aborted ? "条件が変わりました。問い合わせ先を確認し直してください。"
        : accepted ? `${plan.count}店への問い合わせを始めます。` : "問い合わせは行っていません。希望を変更してください。";
      document.getElementById("ns-input")?.focus();
      resolve(accepted);
    };
    const abort = () => finish(false);
    yes.addEventListener("click", () => finish(true), { once: true });
    no.addEventListener("click", () => finish(false), { once: true });
    signal.addEventListener("abort", abort, { once: true });
    buttons.append(yes, no);
    card.append(title, summary, targets, origins, buttons);
    messages.append(card);
    messages.scrollTop = messages.scrollHeight;
    if (signal.aborted) finish(false);
  });
}

// One shop's own page, shown inside this site. The shop's assistant runs in that page;
// its model requests are relayed here and answered with the visitor's own AI setup
// (llm-relay.js). The visitor talks to the shop and reserves in the shop's page.
// This site reserves nothing, and never shows a reservation as made.
import { allergenLabel, COURSE_LABELS } from "./finder.js";

const STORAGE_KEY = "reservation-finder-shop-v1";
const FRAME_WAIT_MS = 8000;

/** The shop id a link asked for: null when none, undefined when it is not a usable id. */
export function requestedShop(search) {
  const params = new URLSearchParams(search);
  if (!params.has("shop")) return null;
  const id = params.get("shop");
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(id) ? id : undefined;
}

/** The search conditions as one line the visitor can check before they go to a shop. */
export function conditionsLine(conditions) {
  if (!conditions) return "お店に渡した検索条件：なし（日時と人数はお店のページで入力できます）";
  const c = conditions;
  return `お店に渡した検索条件：${c.date} ${c.time} / ${c.partySize}名 / ${COURSE_LABELS[c.course]}`
    + (c.budgetPerPerson ? ` / 1人${c.budgetPerPerson.toLocaleString("ja-JP")}円` : "")
    + (c.avoid.length ? ` / 避けたい食材：${c.avoid.map(allergenLabel).join("、")}` : "")
    + "（名前・連絡先・メモ・AIのキーは渡しません）";
}

/**
 * Whether a message really comes from the shop this site is showing: from the frame's own
 * window, at the shop's origin. Anything else is ignored, whatever it claims.
 */
export function fromShopFrame(event, frameWindow, shop) {
  return !!shop && !!frameWindow && event.source === frameWindow && event.origin === new URL(shop.pageUrl).origin
    && !!event.data && typeof event.data.type === "string";
}

export class ShopFrame {
  constructor({ shops, relay, getPage, modelName, storage = null }) {
    this.shops = shops;
    this.relay = relay;
    this.getPage = getPage;
    this.modelName = modelName;
    this.storage = storage;
    this.shop = null;
    this.conditions = null;
    this.frameTimer = null;
    this.asking = false;
    this.relayState = "none";
    relay.onChange = () => this.render();
  }

  element(id) {
    return document.getElementById(id);
  }

  find(id) {
    return this.shops.find(shop => shop.id === id) || null;
  }

  remember() {
    try {
      if (this.shop) this.storage?.setItem(STORAGE_KEY, this.shop.id);
      else this.storage?.removeItem(STORAGE_KEY);
    } catch { /* Storage may be disabled. */ }
    // The address names the shop and nothing else.
    const url = new URL(location.href);
    if (this.shop) url.searchParams.set("shop", this.shop.id);
    else url.searchParams.delete("shop");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  /** The shop to reopen after a reload, such as the one saving the AI setup makes. */
  remembered() {
    try { return this.storage?.getItem(STORAGE_KEY) || null; } catch { return null; }
  }

  showError(reason) {
    this.element("shop-error-text").textContent = reason;
    this.element("shop-error").hidden = false;
  }

  post(message) {
    // Addressed to the shop's origin alone; if the frame has gone elsewhere, nothing is delivered.
    this.element("shop-page-frame").contentWindow?.postMessage(message, new URL(this.shop.pageUrl).origin);
  }

  /**
   * Show a registered shop's page beside the chat. An unregistered shop opens nothing.
   * Called by the page's buttons, by a link from a shop's site, and by the assistant.
   */
  open(id) {
    const shop = typeof id === "string" ? this.find(id) : null;
    if (!shop) {
      const reason = "指定されたお店は登録されていません。お店は開いていません。登録店の一覧から選んでください。";
      this.showError(reason);
      return { ok: false, reason };
    }
    this.element("shop-error").hidden = true;
    this.endRelay("switched");
    this.shop = shop;
    // The search conditions go in the address fragment, as when moving to the shop's site: they are
    // read by the shop's page and are not sent to its server. No name, contact, note or key is among them.
    const framed = this.getPage().framedShopUrl(shop.id);
    this.conditions = framed.conditions;
    // A new window for every opening: delayed messages from the old document
    // cannot request permission or use the next shop's session.
    const previous = this.element("shop-page-frame");
    const frame = previous.cloneNode(false);
    frame.removeAttribute("src");
    previous.replaceWith(frame);
    const status = this.element("shop-page-status");
    frame.title = `${shop.name}のページ`;
    this.element("shop-page-newtab").href = shop.pageUrl;
    status.dataset.state = "loading";
    status.textContent = `${shop.name}のページを読み込んでいます…`;
    frame.src = framed.url;
    this.element("shop-page-panel").hidden = false;
    this.element("assistant-layout").dataset.page = "open";
    this.setMobileView("page");
    clearTimeout(this.frameTimer);
    // A page that refuses to be framed sends nothing, and the browser does not say so either.
    this.frameTimer = setTimeout(() => {
      if (status.dataset.state !== "loading") return;
      status.dataset.state = "failed";
      status.textContent = "このお店のページを、ここに表示できたか確認できませんでした。お店が埋め込みを許可していないか、読み込みに時間がかかっています。表示されない場合は、別タブで開いてください（別タブでは、ここで設定したAIは自動では使えません）。";
    }, FRAME_WAIT_MS);
    this.remember();
    this.render();
    return { ok: true, shop: shop.name, conditionsPassed: !!framed.conditions, note: "お店のページをこの画面内に開きました。相談と予約は、利用者がお店のページで行います。" };
  }

  /** Close the shop's page. The search, its conditions and its results stay as they are. */
  close() {
    if (!this.shop) return;
    this.endRelay("closed");
    clearTimeout(this.frameTimer);
    this.shop = null;
    this.conditions = null;
    this.element("shop-page-frame").removeAttribute("src");
    this.element("shop-page-panel").hidden = true;
    this.element("assistant-layout").dataset.page = "closed";
    this.setMobileView("chat");
    this.remember();
    this.render();
  }

  /** Stop relaying for the shop on show: its page is told, and its later requests are refused. */
  endRelay(state) {
    this.asking = false;
    this.element("shop-relay-consent").hidden = true;
    const closed = this.relay.close();
    if (closed && this.shop) this.post({ type: "gemihub:relay-closed", session: closed.id, reason: "The visitor stopped the AI relay on the finder site." });
    this.relayState = state === "stopped" && closed ? "stopped" : "none";
    this.render();
  }

  /** The shop's page asked to use the visitor's AI. Nothing is relayed until the visitor says so here. */
  askConsent() {
    const shop = this.shop;
    if (!this.relay.ready()) {
      this.relayState = "no-setup";
      this.post({ type: "gemihub:relay-denied", reason: "No AI setup on the finder site yet." });
      this.render();
      return;
    }
    this.asking = true;
    this.element("shop-relay-question").textContent = `「${shop.name}」のチャットに、あなたのAI（${this.modelName()}）を使いますか？`;
    this.element("shop-relay-detail").textContent = `お店のページ（${new URL(shop.pageUrl).host}）のチャットでの会話と、お店のエージェントの定義が、このサイトを通してあなたのLLMプロバイダーに送られます。APIキーはお店に渡しません。費用はあなたのAI設定にかかります。上限は${this.relay.limits.maxRequests}回・${this.relay.limits.maxMinutes}分で、いつでも止められます。`;
    this.element("shop-relay-consent").hidden = false;
    this.relayState = "asking";
    this.render();
  }

  answerConsent(allowed) {
    if (!this.asking || !this.shop) return;
    this.asking = false;
    this.element("shop-relay-consent").hidden = true;
    if (!allowed) {
      this.relayState = "denied";
      this.post({ type: "gemihub:relay-denied", reason: "The visitor did not allow it." });
    } else {
      const session = this.relay.open(this.shop);
      this.relayState = "open";
      // The session label and the model's name: no key, router or account detail.
      this.post({ type: "gemihub:relay-open", session: session.id, model: this.modelName() });
    }
    this.render();
  }

  /** Messages are believed only from the frame showing the shop, at that shop's origin. */
  onMessage(event) {
    const frame = this.element("shop-page-frame");
    if (!fromShopFrame(event, frame.contentWindow, this.shop)) return;
    const data = event.data;
    if (data.type === "gemihub:reserve-ready" && data.version === 1) {
      clearTimeout(this.frameTimer);
      const status = this.element("shop-page-status");
      status.dataset.state = "ready";
      status.textContent = `${this.shop.name}のページです。相談と予約はこのページで行い、予約の結果もこのページに表示されます。`;
    } else if (data.type === "gemihub:relay-hello" && data.version === 1) {
      // A reloaded page starts over: the earlier session is gone and the visitor is asked again.
      this.endRelay("reloaded");
      this.askConsent();
    } else if (data.type === "gemihub:llm-request") {
      const session = data.session;
      void this.relay.handle(data, (type, fields) => {
        // An answer for a session that has ended, or for a shop no longer on show, is not delivered.
        if (this.relay.session?.id === session || type === "error") this.post({ type: `gemihub:llm-${type}`, session, id: data.id, ...fields });
      });
    } else if (data.type === "gemihub:llm-abort" && data.session === this.relay.session?.id) {
      this.relay.abort(data.id);
    }
  }

  /** On a narrow screen the chat and the shop's page take turns. */
  setMobileView(view) {
    this.element("assistant-layout").dataset.view = view;
    for (const [id, name] of [["shop-view-chat", "chat"], ["shop-view-page", "page"]]) {
      this.element(id).setAttribute("aria-pressed", String(view === name));
    }
  }

  render() {
    const shop = this.shop;
    this.element("shop-bar").hidden = !shop;
    this.element("shop-view-tabs").hidden = !shop;
    if (!shop) return;
    this.element("shop-name").textContent = shop.name;
    this.element("shop-host").textContent = `${shop.area} / ${shop.cuisine} · ${new URL(shop.pageUrl).host}`;
    this.element("shop-conditions").textContent = conditionsLine(this.conditions);
    const usage = this.relay.status();
    const text = {
      none: "お店のチャットは、あなたの許可を待ってから、ここで設定したAIを使います。",
      asking: "お店のチャットがAIの利用を求めています。下で選んでください。",
      "no-setup": "お店のチャットを使うには、先にこのサイトでAIを設定してください。予約フォームはそのまま使えます。",
      denied: "AIの利用を許可していません。お店のチャットは動きません。予約フォームはそのまま使えます。",
      stopped: "AIの中継を止めました。お店のチャットをまた使うには「開き直す」を押してください。",
      open: usage ? `お店のチャットにあなたのAIを中継しています（${usage.requests} / ${usage.maxRequests}回・残り約${usage.minutesLeft}分）。キーはお店に渡していません。` : "",
    }[usage ? "open" : this.relayState === "open" ? "stopped" : this.relayState];
    this.element("shop-relay-status").textContent = text;
    this.element("shop-relay-stop").hidden = !usage;
    this.element("shop-reopen").hidden = !!usage || this.relayState === "none" || this.relayState === "asking";
  }

  /** Connect the page's own controls, then open the shop a link or an earlier visit asked for. */
  mount() {
    this.element("shop-close").addEventListener("click", () => this.close());
    this.element("shop-reopen").addEventListener("click", () => this.open(this.shop.id));
    this.element("shop-relay-stop").addEventListener("click", () => this.endRelay("stopped"));
    this.element("shop-relay-allow").addEventListener("click", () => this.answerConsent(true));
    this.element("shop-relay-deny").addEventListener("click", () => this.answerConsent(false));
    this.element("shop-view-chat").addEventListener("click", () => this.setMobileView("chat"));
    this.element("shop-view-page").addEventListener("click", () => this.setMobileView("page"));
    window.addEventListener("message", event => this.onMessage(event));
    window.addEventListener("pagehide", () => this.endRelay("closed"));
    // The time left is shown to the minute.
    setInterval(() => { if (this.relay.session) this.render(); }, 30000);
    const requested = requestedShop(location.search);
    if (requested === undefined) {
      this.showError("お店の指定が正しくありません。お店は開いていません。登録店の一覧から選んでください。");
      this.remember();
    } else {
      const id = requested || this.remembered();
      if (id && !this.open(id).ok) this.remember();
    }
    this.render();
  }
}

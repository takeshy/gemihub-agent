import { FinderPage } from "./finder.js";
import { shops } from "./shop-registry.js";

const node = (tag, content, className) => {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = String(content);
  if (className) element.className = className;
  return element;
};

export class App {
  static inquiries = null;
  static page = new FinderPage(shops, {
    // Leave the tool receipt time to reach the chat before leaving this document.
    navigate: url => setTimeout(() => location.assign(url), 100),
    onChange: kind => { if (typeof document !== "undefined") App.render(kind); },
  });
  static saveDraft() {
    // The official AI settings reload the page. Keep conditions in this tab only;
    // comparison results and any provider credentials are never stored here.
    try { sessionStorage.setItem("reservation-finder-draft-v1", JSON.stringify(App.page.conditions)); } catch { /* Storage may be disabled. */ }
  }

  static restoreDraft() {
    try {
      const draft = JSON.parse(sessionStorage.getItem("reservation-finder-draft-v1"));
      if (!draft || Array.isArray(draft) || typeof draft !== "object") return;
      const known = ["date", "time", "partySize", "course", "budgetPerPerson", "avoid", "note"];
      if (Object.keys(draft).some(key => !known.includes(key))) return;
      if (!["date", "time", "course", "note"].every(key => typeof draft[key] === "string")) return;
      if (draft.date.length > 10 || draft.time.length > 5 || draft.note.length > 500 || !["none", "wanted", "any"].includes(draft.course)) return;
      if (draft.partySize !== null && (typeof draft.partySize !== "number" || !Number.isFinite(draft.partySize))) return;
      if (draft.budgetPerPerson !== undefined && (typeof draft.budgetPerPerson !== "number" || !Number.isFinite(draft.budgetPerPerson))) return;
      if (!Array.isArray(draft.avoid) || draft.avoid.length > 13 || !draft.avoid.every(word => typeof word === "string" && word.length <= 20)) return;
      App.page.editConditions(draft);
    } catch { /* Invalid or unavailable tab storage must not prevent startup. */ }
  }

  static render(kind) {
    if (kind === "conditions" || kind === "draft") {
      App.saveDraft();
      App.inquiries?.invalidate();
    }
    App.renderCandidates(App.page.getState());
  }

  static renderCandidates(state) {
    const messages = document.getElementById("ns-msgs");
    if (!messages) return;
    let current = null;
    for (const message of messages.querySelectorAll(".finder-results")) {
      if (Number(message.dataset.version) === state.version && state.candidates.length) {
        current = message;
      } else {
        message.dataset.current = "false";
        message.querySelector(".finder-results-status").textContent = "条件が変わりました。最新の条件で問い合わせてください。";
        for (const button of message.querySelectorAll("button")) button.disabled = true;
      }
    }
    if (!state.candidates.length) return;
    if (!current) {
      current = node("div", undefined, "ns-msg bot finder-results");
      current.dataset.version = String(state.version);
      current.setAttribute("role", "group");
      current.setAttribute("aria-label", "お店からの回答");
      messages.append(current);
    }
    current.dataset.current = "true";
    const heading = node("p", `${state.conditions.date} ${state.conditions.time} / ${state.conditions.partySize}名 · ${state.candidates.length}店の回答`, "finder-results-heading");
    const list = node("div", undefined, "finder-candidate-list");
    const status = node("p", "", "finder-results-status");
    status.setAttribute("role", "status");
    current.replaceChildren(heading, list, status);
    const labels = { available: "空きあり", full: "満席", unknown: "確認できず", declined: "問い合わせを拒否" };
    for (const candidate of state.candidates) {
      const shop = shops.find(item => item.id === candidate.shopId);
      const card = node("article", undefined, "candidate-card");
      card.append(node("span", labels[candidate.status], `status-badge status-${candidate.status}`), node("h3", shop.name), node("p", candidate.summary));
      if (candidate.status === "available") {
        const details = node("dl");
        const line = (label, value) => { if (value !== undefined) details.append(node("dt", label), node("dd", value)); };
        line("残りの席", candidate.remaining === undefined ? undefined : `${candidate.remaining}席`);
        line("利用時間", candidate.durationMinutes === undefined ? undefined : `${candidate.durationMinutes}分`);
        line("席のみ", candidate.seatOnly === undefined ? undefined : candidate.seatOnly ? "予約できます" : "コース予約のみ");
        if (state.conditions.course !== "none") { line("コース", candidate.courseName); line("1人あたり・合計見込み", candidate.priceText); }
        card.append(details);
        if (candidate.avoidResult) card.append(node("p", `食材の確認：${candidate.avoidResult}`, "allergen-note"));
      }
      const button = node("button", "この店を見てみる", "candidate-button");
      button.type = "button";
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const args = { shopId: shop.id, expectedVersion: state.version,
            ...(candidate.status === "available" && state.conditions.course !== "none" && candidate.courseId ? { courseId: candidate.courseId } : {}) };
          const { AssistantMount } = await import("./site.js");
          const allowed = await AssistantMount.review([{ action: "open_shop_page", origin: location.origin, effect: "irreversible", arguments: args }]);
          if (allowed) {
            const receipt = App.page.openShopPage(args);
            if (!receipt.ok) status.textContent = receipt.reason;
          }
        } catch (error) { status.textContent = error.message; }
        finally { button.disabled = state.version !== App.page.version || !App.page.candidates.length; }
      });
      card.append(button);
      list.append(card);
    }
    messages.scrollTop = messages.scrollHeight;
  }

  static mountChat() {
    document.getElementById("ns-newchat").addEventListener("click", () => {
      App.page.clearCandidates();
      App.inquiries?.reset();
    });
    App.render("init");
  }

  static start() {
    App.restoreDraft();
    document.getElementById("shop-count").textContent = String(shops.length);
    const list = document.getElementById("shop-list");
    for (const shop of shops) {
      const card = node("article", undefined, "shop-card");
      card.append(node("span", `${shop.area} / ${shop.cuisine}`, "eyebrow"), node("h3", shop.name));
      const link = node("a", "お店のページを見る ↗");
      link.href = shop.pageUrl; link.rel = "noreferrer";
      card.append(link);
      const details = node("details"); details.append(node("summary", "公開URLを確認"));
      for (const [label, url] of [["予約ページ", shop.pageUrl], ["ネットワーク", shop.networkUrl]]) {
        const a = node("a", `${label}：${url}`); a.href = url; a.rel = "noreferrer"; details.append(a);
      }
      card.append(details); list.append(card);
    }
    App.render("init");
  }
}

if (typeof window !== "undefined") App.start();

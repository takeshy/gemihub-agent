import { getSelectedByokProfile, loadTabByokSetup } from "./runtime/byok.js";

const modeKey = "gemihub-ai-mode";
export async function aiConnection() {
  let config;
  try {
    const response = await fetch("/api/ai/config", { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    config = await response.json();
  } catch { return null; }
  if (!config.managed) return null;
  let mode = "managed";
  try { if (localStorage.getItem(modeKey) === "byok") mode = "byok"; } catch { /* Tab still works. */ }
  let setup = null;
  if (mode === "managed") {
    const response = await fetch("/api/ai/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!response.ok) throw new Error("Geminiの準備ができませんでした。しばらくしてから再読み込みしてください。");
    const session = await response.json();
    setup = { router: new URL(session.router, location.origin).href, byokKey: session.token, model: session.model };
  }
  return { mode, config, setup };
}

/** Extend the unchanged runtime's settings; managed session tokens are never saved as BYOK profiles. */
export function mountAiConnection(engine, connection) {
  if (!connection) return;
  const english = document.documentElement.lang === "en";
  const dialog = document.getElementById("ai-setup-dialog"), root = document.getElementById("agent-app");
  const select = document.createElement("select"); select.id = "ai-connection-mode";
  select.add(new Option(english ? "Site's Gemini (default)" : "運営のGemini（標準）", "managed"));
  select.add(new Option(english ? "My API key (BYOK)" : "自分のAPIキー（BYOK）", "byok"));
  select.value = connection.mode;
  const label = document.createElement("label"); label.htmlFor = select.id;
  label.textContent = english ? "AI connection" : "AIの利用方法"; label.append(select);
  (dialog.querySelector(".ai-setup-header") || dialog.querySelector("h2")).after(label);
  const key = root.querySelector("#ns-key"), router = root.querySelector("#ns-router"), model = root.querySelector("#ns-model");
  const provider = document.getElementById("ai-provider"), link = document.getElementById("ai-key-link")?.closest("p");
  const fields = [provider.closest("label"), link, key.closest("label"), root.querySelector(".ns-settings-advanced")].filter(Boolean);
  const description = document.getElementById("ai-setup-description");
  const oldDescription = description.textContent;
  const update = () => {
    const managed = select.value === "managed";
    for (const field of fields) { field.hidden = managed; field.style.display = managed ? "none" : ""; }
    description.textContent = managed
      ? english ? "Use the site's Gemini without an API key. You can switch to your own key. Changing the connection starts a new conversation." : "APIキーの入力なしでGeminiを利用できます。自分のキーにも切り替えられます。利用方法を切り替えると会話を始め直します。"
      : oldDescription;
    if (!managed && connection.mode === "managed") {
      const saved = loadTabByokSetup(getSelectedByokProfile());
      key.value = saved.key || ""; router.value = saved.router || engine.top.manifest?.llm_router?.byok_router || "https://openrouter.ai/api/v1";
      model.value = saved.model || "";
      router.dispatchEvent(new Event("input", { bubbles: true }));
    }
  };
  select.addEventListener("change", update);
  dialog.addEventListener("click", event => {
    if (!event.target.closest("#ns-apply")) return;
    const desired = select.value;
    if (desired === "byok" && ![key, router, model].every(field => field.checkValidity())) return;
    try { localStorage.setItem(modeKey, desired); } catch { /* Active connection still works. */ }
    if (desired !== connection.mode) root.querySelector("#ns-newchat")?.click();
    if (desired === "managed") {
      event.preventDefault(); event.stopImmediatePropagation();
      if (connection.mode === "managed") dialog.close(); else location.reload();
    }
  }, { capture: true });
  document.getElementById("ai-settings-open").addEventListener("click", () => { select.value = connection.mode; update(); });
  if (connection.mode === "managed") {
    root.dataset.aiConnection = "managed";
    const badge = root.querySelector(".ns-llmbadge"); if (badge) { badge.textContent = "Gemini"; badge.title = english ? "Gemini provided by this site" : "運営が提供するGeminiを利用しています"; }
    const keyNote = document.getElementById("assistant-key-note");
    if (keyNote) keyNote.textContent = english ? "No API key is needed. You can choose your own key in AI settings." : "APIキーの入力は不要です。AIの設定から自分のキーにも切り替えられます。";
    const privacy = document.getElementById("assistant-privacy-note");
    if (privacy) privacy.textContent = english ? "Messages go to Gemini through the site's server. The site's API key is never shared with your browser." : "メッセージは運営側のサーバーを経由してGeminiへ送られます。運営のAPIキーはブラウザへ渡しません。";
  }
  update();
}

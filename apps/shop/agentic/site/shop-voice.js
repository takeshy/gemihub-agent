import { GuideVoice } from "./voice-chat.js";
import { runVisibleChatTurn } from "./voice-turn.js";

function controls() {
  const host = document.createElement("div"); host.className = "shop-voice-controls finder-voice-entry";
  const row = document.createElement("div"); row.className = "shop-voice-heading";
  const heading = document.getElementById("assistant-heading");
  heading.before(row); row.append(heading, host);
  return host;
}

export function mountShopVoice(engine, config) {
  if (!config?.voice) return;
  const host = controls();
  const shop = { id: document.documentElement.dataset.slug, name: document.documentElement.dataset.shopName || document.getElementById("assistant-heading").textContent };
  const shopFrame = { shop, askVoice: (question, signal) => runVisibleChatTurn(document, question, signal) };
  const voice = new GuideVoice({ engine, shopFrame, ownShop: shop, config, launcherHost: host });
  const observer = new MutationObserver(() => {
    if (voice.state !== "off") voice.review(!!document.querySelector("dialog[open]:not(#finder-voice), .ns-consent-actions"));
  });
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
  document.getElementById("assistant-close").addEventListener("click", () => { voice.dialog.close(); voice.stop(); });
  window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
  return voice;
}

export function mountEmbeddedShopVoice() {
  const origin = document.documentElement.dataset.parentOrigin;
  const shop = document.documentElement.dataset.slug;
  if (!origin || !shop) return;
  const host = controls(); host.hidden = true;
  const button = document.createElement("button"); button.id = "voice-open"; button.type = "button"; button.className = "finder-voice-launcher";
  button.textContent = document.documentElement.lang === "en" ? "🎙 Talk to AI" : "🎙 音声で話す";
  button.setAttribute("aria-haspopup", "dialog"); host.append(button);
  let available = false, panelOpen = false;
  window.addEventListener("message", event => {
    if (event.source !== window.parent || event.origin !== origin || event.data?.shop !== shop) return;
    if (event.data.type === "gemihub:voice-capabilities") { available = event.data.available === true; panelOpen = event.data.panelOpen === true; }
    else if (event.data.type === "gemihub:voice-panel") panelOpen = event.data.open === true;
    else return;
    host.hidden = !available || panelOpen;
  });
  button.addEventListener("click", () => window.parent.postMessage({ type: "gemihub:voice-open", shop }, origin));
  window.parent.postMessage({ type: "gemihub:voice-capabilities", shop }, origin);
}

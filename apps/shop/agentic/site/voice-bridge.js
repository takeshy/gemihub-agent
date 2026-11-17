import { runVisibleChatTurn } from "./voice-turn.js";

// Only the configured parent window can supply a voice question. No microphone, key or parent history enters the shop.
export function mountShopVoiceBridge(startAssistant, shop) {
  const parentOrigin = document.documentElement.dataset.parentOrigin;
  if (!parentOrigin || window.parent === window) return;
  let channel = null, connecting = null, current = null;
  const post = data => window.parent.postMessage({ ...data, shop, channel }, parentOrigin);
  window.addEventListener("message", event => {
    if (event.origin !== parentOrigin || event.source !== window.parent || !event.data || typeof event.data !== "object") return;
    const data = event.data;
    if (typeof data.channel !== "string" || data.channel.length > 80) return;
    if (data.type === "gemihub:voice-connect" && data.shop === shop) {
      if (current || connecting) return;
      channel = data.channel;
      const token = channel;
      connecting = (async () => {
        try {
          const panel = document.getElementById("assistant");
          if (panel?.hidden) document.getElementById("assistant-toggle")?.click();
          const engine = await startAssistant();
          if (!engine || channel !== token) throw new Error();
          post({ type: "gemihub:voice-ready" });
        } catch { post({ type: "gemihub:voice-error", id: token }); }
        finally { connecting = null; }
      })();
      return;
    }
    if (channel !== data.channel) return;
    if (data.type === "gemihub:voice-cancel" && data.id === current?.id) { current.controller.abort(); return; }
    if (data.type !== "gemihub:voice-question" || typeof data.id !== "string" || data.id.length > 80 || typeof data.question !== "string" || !data.question.trim() || data.question.length > 4000) return;
    if (current) return;
    const request = { id: data.id, controller: new AbortController() }; current = request;
    // A parent modal makes this entire frame inert. Let the parent uncover the shop's
    // confirmation while retaining the voice connection, then restore its voice dialog.
    let reviewing = false;
    const review = () => {
      const open = !!document.querySelector('dialog[open], .ns-consent-actions');
      if (open === reviewing) return;
      reviewing = open; post({ type: "gemihub:voice-review", id: request.id, open });
    };
    const observer = new MutationObserver(review);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    review();
    void runVisibleChatTurn(document, data.question, request.controller.signal).then(answer => {
      if (request.controller.signal.aborted) return;
      post({ type: "gemihub:voice-answer", id: request.id, answer });
    }).catch(() => post({ type: "gemihub:voice-error", id: request.id })).finally(() => { observer.disconnect(); if (reviewing) post({ type: "gemihub:voice-review", id: request.id, open: false }); if (current === request) current = null; });
  });
  window.addEventListener("pagehide", () => current?.controller.abort());
}

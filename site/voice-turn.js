// Send through the existing chat UI so tool policy, history and screen confirmations stay identical.
export function runVisibleChatTurn(doc, question, signal) {
  const input = doc.getElementById("ns-input"), send = doc.getElementById("ns-send"), bar = doc.querySelector(".ns-inputbar");
  const engine = doc.defaultView?.__nsweb?.engine;
  if (!engine || !input || !send || !bar || send.disabled || bar.dataset.turnActive === "true") return Promise.reject(new Error("チャットの処理が終わってからお話しください。"));
  if (typeof question !== "string" || !question.trim() || question.length > 4000 || signal?.aborted) return Promise.reject(new Error("質問を確認してください。"));
  return new Promise((resolve, reject) => {
    const previous = input.value;
    const before = new Set(doc.querySelectorAll("#ns-msgs .ns-msg.bot"));
    let began = false, settled = false, cancelled = false;
    const originalConfirm = engine.onActionConfirm, originalConsent = engine.onConsent;
    const stopped = () => cancelled || !!signal?.aborted;
    // Website actions resolve to true/false. Consent resolves to "allow"|"always"|"decline", and the
    // engine treats an empty answer as "allow", so a cancelled voice turn must decline explicitly.
    // A missing consent hook stays allowed as before, unless this voice turn was cancelled.
    const confirm = async (...args) => !stopped() && typeof originalConfirm === "function" && !!await originalConfirm(...args) && !stopped();
    const consent = async (...args) => {
      if (stopped()) return "decline";
      const decision = typeof originalConsent === "function" ? await originalConsent(...args) : "allow";
      return stopped() ? "decline" : decision;
    };
    engine.onActionConfirm = confirm; engine.onConsent = consent;
    const finish = (error, answer) => {
      if (settled) return; settled = true;
      clearTimeout(timer); observer.disconnect(); signal?.removeEventListener("abort", aborted);
      if (engine.onActionConfirm === confirm) engine.onActionConfirm = originalConfirm;
      if (engine.onConsent === consent) engine.onConsent = originalConsent;
      if (!input.value && previous) input.value = previous;
      error ? reject(error) : resolve(answer);
    };
    const observer = new MutationObserver(() => {
      if (bar.dataset.turnActive === "true") began = true;
      if (!began || bar.dataset.turnActive !== "false") return;
      const messages = [...doc.querySelectorAll("#ns-msgs .ns-msg.bot")].filter(node => !before.has(node) && !node.matches(".ns-turn-status,.finder-results,.finder-introductions,.finder-inquiry,.ns-consent"));
      const answer = messages.map(node => node.textContent).join("\n").trim();
      finish(signal?.aborted ? new Error("音声の質問を中止しました。") : !answer ? new Error("回答を確認できませんでした。画面を確認してください。") : null, answer.slice(0, 20000));
    });
    // Keep confirmation guards until the existing turn finishes, even if audio stops while a dialog is open.
    const aborted = () => { cancelled = true; if (!began) finish(new Error("音声の質問を中止しました。")); };
    const timer = setTimeout(() => { cancelled = true; finish(new Error("回答の完了を確認できませんでした。画面を確認してください。")); }, 125000);
    observer.observe(doc.getElementById("agent-app"), { subtree: true, attributes: true, childList: true });
    signal?.addEventListener("abort", aborted, { once: true });
    input.value = question; input.dispatchEvent(new Event("input", { bubbles: true })); send.click();
  });
}

import { API_KEY_PROVIDERS } from "./runtime/ui.js";

// Reuse the runtime's settings fields and save handler; it remains responsible
// for credentials, profiles and reloading with the applied setup.
export function mountAISetup(engine) {
  const root = document.getElementById("agent-app");
  const dialog = document.getElementById("ai-setup-dialog");
  const select = document.getElementById("ai-provider");
  const keyLink = document.getElementById("ai-key-link");
  const openButton = document.getElementById("ai-settings-open");
  const closeButton = document.getElementById("ai-setup-close");
  const settings = root.querySelector(".ns-settings");
  const router = root.querySelector("#ns-router");
  const model = root.querySelector("#ns-model");
  const key = root.querySelector("#ns-key");
  const profileName = root.querySelector("#ns-profile-name");
  const hint = root.querySelector("#ns-profile-hint");
  const advanced = root.querySelector(".ns-settings-advanced");
  const defaultModel = engine.top.network.config.llm_config.model_name;
  const providers = [...API_KEY_PROVIDERS, {
    name: "OpenRouter", router: "https://openrouter.ai/api/v1", model: defaultModel,
    keyUrl: "https://openrouter.ai/settings/keys",
  }];
  for (const provider of providers) select.add(new Option(provider.name, provider.name));
  select.add(new Option("その他（接続先を指定）", "custom"));
  // Saved profiles remain available without crowding the first-time setup.
  advanced.querySelector(".ns-settings-advanced-body").prepend(root.querySelector("#ns-profile").closest("label"));
  advanced.querySelector("summary").textContent = "モデル・接続先などの詳細設定";
  key.closest("label").querySelector("span").textContent = "APIキー";
  key.placeholder = "選んだプロバイダーのAPIキーを貼り付け";
  root.querySelector("#ns-model-label").textContent = "モデル";
  router.closest("label").firstChild.textContent = "接続先URL ";
  profileName.closest("label").firstChild.textContent = "設定名（任意） ";
  root.querySelector("#ns-profile").closest("label").firstChild.textContent = "保存済み設定 ";
  router.type = "url";
  router.required = true;
  model.required = true;
  const apply = root.querySelector("#ns-apply");
  apply.textContent = "保存して始める";
  const needsKey = !engine.mockLLM && (!engine.byokKey || engine.byokKey === "demo");
  closeButton.hidden = needsKey;

  const resetHint = () => {
    hint.className = "ns-hint";
    hint.textContent = "設定はこのブラウザに保存されます。";
  };
  const normalizeRouter = value => value.trim().replace(/\/+$/, "");
  const updateLink = () => {
    const provider = providers.find(item => item.name === select.value);
    keyLink.hidden = !provider;
    if (provider) {
      keyLink.href = provider.keyUrl;
      keyLink.textContent = `${provider.name}でAPIキーを取得 ↗`;
    } else keyLink.removeAttribute("href");
  };
  const syncProvider = () => {
    select.value = providers.find(item => normalizeRouter(item.router) === normalizeRouter(router.value))?.name || "custom";
    updateLink();
  };
  select.addEventListener("change", () => {
    const provider = providers.find(item => item.name === select.value);
    // A key belongs to one provider. Do not carry it to a newly chosen endpoint.
    if (!provider || normalizeRouter(provider.router) !== normalizeRouter(router.value)) {
      key.value = "";
      key.dispatchEvent(new Event("input", { bubbles: true }));
    }
    router.value = provider?.router || "";
    model.value = provider?.model || "";
    profileName.value = provider?.name || "";
    router.dispatchEvent(new Event("input", { bubbles: true }));
    model.dispatchEvent(new Event("input", { bubbles: true }));
    advanced.open = !provider;
    updateLink();
    resetHint();
  });
  // Recognized key prefixes may make the runtime choose a provider itself.
  key.addEventListener("input", () => { syncProvider(); resetHint(); });
  router.addEventListener("input", syncProvider);
  root.querySelector("#ns-profile").addEventListener("change", syncProvider);
  apply.addEventListener("click", event => {
    for (const field of [key, router, model]) {
      if (!field.checkValidity()) {
        event.stopImmediatePropagation();
        if (field !== key) advanced.open = true;
        field.reportValidity();
        return;
      }
    }
  }, { capture: true });

  const restoreAppliedSetup = () => {
    key.value = engine.byokKey || "";
    router.value = engine.routerOverride || engine.top.llm.baseUrl;
    model.value = engine.modelOverride || defaultModel;
    syncProvider();
  };
  const open = () => {
    restoreAppliedSetup();
    resetHint();
    settings.open = true;
    advanced.open = select.value === "custom";
    dialog.showModal();
  };
  dialog.addEventListener("cancel", event => { if (needsKey) event.preventDefault(); });
  dialog.addEventListener("close", () => {
    restoreAppliedSetup();
    settings.open = false;
    root.querySelector("#ns-input")?.focus();
  });
  // Runtime validation can request settings again (for example, for an unknown
  // model). Keep its feedback visible in the modal without resetting the fields.
  settings.addEventListener("toggle", () => {
    if (settings.open && !dialog.open) dialog.showModal();
  });
  closeButton.addEventListener("click", () => dialog.close());
  openButton.addEventListener("click", open);
  openButton.disabled = false;
  restoreAppliedSetup();
  resetHint();
  settings.open = false;
  if (needsKey) open();
}

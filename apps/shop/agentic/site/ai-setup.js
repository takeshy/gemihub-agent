// Adapted from gemihub-agent's modal. The unmodified runtime owns the settings,
// profile storage, validation and save handler; its fields stay inside #agent-app.
import { API_KEY_PROVIDERS } from "./runtime/ui.js";

export function mountAISetup(engine) {
  const root = document.getElementById("agent-app");
  const dialog = document.getElementById("ai-setup-dialog");
  const select = document.getElementById("ai-provider");
  const keyLink = document.getElementById("ai-key-link");
  const openButton = document.getElementById("ai-settings-open");
  const settings = root.querySelector(".ns-settings");
  const router = root.querySelector("#ns-router");
  const model = root.querySelector("#ns-model");
  const key = root.querySelector("#ns-key");
  const profileName = root.querySelector("#ns-profile-name");
  const advanced = root.querySelector(".ns-settings-advanced");
  const english = document.documentElement.lang === "en";
  const words = english ? {
    custom: "Other (enter a provider URL)", advanced: "Model, provider URL and saved setups",
    key: "API key", placeholder: "Paste your provider's API key", model: "Model", router: "Provider URL ",
    profile: "Setup name (optional) ", saved: "Saved setup ", save: "Save and start",
    link: name => `Get an API key from ${name} ↗`,
  } : {
    custom: "その他（接続先を指定）", advanced: "モデル・接続先などの詳細設定",
    key: "APIキー", placeholder: "選んだプロバイダーのAPIキーを貼り付け", model: "モデル", router: "接続先URL ",
    profile: "設定名（任意） ", saved: "保存済み設定 ", save: "保存して始める",
    link: name => `${name}でAPIキーを取得 ↗`,
  };
  const providers = [...API_KEY_PROVIDERS, {
    name: "OpenRouter", router: "https://openrouter.ai/api/v1",
    model: engine.top.network.config.llm_config.model_name, keyUrl: "https://openrouter.ai/settings/keys",
  }];
  for (const provider of providers) select.add(new Option(provider.name, provider.name));
  select.add(new Option(words.custom, "custom"));
  const profile = root.querySelector("#ns-profile");
  advanced.querySelector(".ns-settings-advanced-body").prepend(profile.closest("label"));
  advanced.querySelector("summary").textContent = words.advanced;
  key.closest("label").querySelector("span").textContent = words.key;
  key.placeholder = words.placeholder;
  root.querySelector("#ns-model-label").textContent = words.model;
  router.closest("label").firstChild.textContent = words.router;
  profileName.closest("label").firstChild.textContent = words.profile;
  profile.closest("label").firstChild.textContent = words.saved;
  root.querySelector("#ns-apply").textContent = words.save;
  router.type = "url";
  for (const field of [key, router, model]) field.required = true;

  const normalize = value => value.trim().replace(/\/+$/, "");
  const syncProvider = () => {
    const provider = providers.find(item => normalize(item.router) === normalize(router.value));
    select.value = provider?.name || "custom";
    keyLink.hidden = !provider;
    if (provider) { keyLink.href = provider.keyUrl; keyLink.textContent = words.link(provider.name); }
    else keyLink.removeAttribute("href");
  };
  select.addEventListener("change", () => {
    const provider = providers.find(item => item.name === select.value);
    if (!provider || normalize(provider.router) !== normalize(router.value)) {
      key.value = "";
      key.dispatchEvent(new Event("input", { bubbles: true }));
    }
    router.value = provider?.router || "";
    model.value = provider?.model || "";
    profileName.value = provider?.name || "";
    router.dispatchEvent(new Event("input", { bubbles: true }));
    model.dispatchEvent(new Event("input", { bubbles: true }));
    advanced.open = !provider;
    syncProvider();
  });
  key.addEventListener("input", syncProvider);
  router.addEventListener("input", syncProvider);
  profile.addEventListener("change", syncProvider);
  root.querySelector("#ns-apply").addEventListener("click", event => {
    for (const field of [key, router, model]) {
      if (!field.checkValidity()) {
        event.stopImmediatePropagation();
        if (field !== key) advanced.open = true;
        field.reportValidity();
        return;
      }
    }
  }, { capture: true });

  const restore = () => {
    key.value = engine.byokKey || "";
    router.value = engine.routerOverride || engine.top.llm.baseUrl;
    model.value = engine.modelOverride || engine.top.network.config.llm_config.model_name;
    syncProvider();
  };
  const open = () => {
    restore();
    advanced.open = select.value === "custom";
    settings.open = true;
    if (!dialog.open) dialog.showModal();
    (key.value ? select : key).focus();
  };
  document.getElementById("ai-setup-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { restore(); settings.open = false; openButton.focus(); });
  // Runtime errors can reopen settings. Keep its validation feedback in the modal.
  settings.addEventListener("toggle", () => {
    if (settings.open && !dialog.open && !document.getElementById("assistant").hidden) dialog.showModal();
  });
  openButton.addEventListener("click", open);
  openButton.disabled = false;
  restore();
  settings.open = false;
  return {
    openIfNeeded() {
      if (!engine.mockLLM && (!engine.byokKey || engine.byokKey === "demo")) open();
    },
  };
}

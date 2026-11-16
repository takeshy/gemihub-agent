import { canReserve, hasAgent, reservationPageUrl, shopPageUrl } from "/shop-data.js";
import { mountSiteEditor } from "/site-editor.js";

const $ = selector => document.querySelector(selector);
const keys = ["id", "name", "area", "cuisine", "pageUrl", "networkUrl", "description", "address", "reservationUrl"];
const labels = { address: "住所（地図用）", name: "店名", area: "エリア", cuisine: "ジャンル", pageUrl: "店舗ページURL", networkUrl: "ネットワークURL", description: "紹介文", reservationUrl: "予約ページURL" };
const statuses = { connected: "接続OK", "needs-review": "要確認", error: "エラー" };
let state = { shops: [], cache: {} };
let editingId;
let metadata = {};
let busy = false;
let diffs = [];
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
async function api(path, method = "GET", data, headers = {}) {
  const response = await fetch(path, { method, headers: { ...(data === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}
function message(text, error = false) {
  const node = $("#message");
  node.replaceChildren(element("div", text));
  node.className = error ? "error" : "";
  node.hidden = false;
}
function buttons() {
  for (const button of document.querySelectorAll("button")) button.disabled = busy || button.dataset.unavailable === "true";
  for (const input of document.querySelectorAll("input, select, textarea")) input.disabled = busy;
  document.body.setAttribute("aria-busy", String(busy));
}
async function run(operation) {
  if (busy) return;
  busy = true; buttons();
  try { await operation(); }
  catch (error) { message(error.message, true); }
  finally { busy = false; buttons(); }
}
function action(text, handler, { unavailable = false, className = "secondary", title } = {}) {
  const button = element("button", text, className);
  button.type = "button";
  button.dataset.unavailable = String(unavailable);
  if (title) { button.title = title; button.setAttribute("aria-label", title); }
  button.addEventListener("click", () => run(handler));
  return button;
}
function render() {
  $("#shops").replaceChildren();
  $("#empty").hidden = state.shops.length > 0;
  $("#mode").textContent = state.production ? "公開用モード · HTTPSのURLだけ登録できます。保存後は公開サイトを再読み込みしてください。" : "ローカル用モード · 保存後は公開サイトを再読み込みしてください。公開するフォルダは site/ だけです。";
  state.shops.forEach((shop, index) => {
    const row = element("tr");
    for (const value of [shop.name, shop.area, shop.cuisine, new URL(shop.pageUrl).origin]) row.append(element("td", value));
    const info = state.cache[shop.id] || {};
    const status = element("td");
    const badge = element("span", info.status === "connected" && !hasAgent(shop) ? "情報取得済み" : statuses[info.status] || "要確認", `badge ${info.status || ""}`);
    badge.title = info.error || (info.fetchedAt ? `最終取得: ${info.fetchedAt}` : "まだ店の情報を取得していません");
    status.append(badge);
    if (info.error) status.append(element("div", info.error, "note"));
    row.append(status);
    const operations = element("td", undefined, "actions");
    operations.append(
      action("編集", () => showEditor(shop)),
      action("再読込", async () => { showEditor(shop); await resolvePreview(); }),
      action("削除", async () => {
        if (!confirm(`「${shop.name}」を削除しますか？`)) return;
        state = await api(`/api/shops/${encodeURIComponent(shop.id)}`, "DELETE", undefined, { "If-Match": state.revision });
        if (editingId === shop.id) $("#editor").hidden = true;
        render(); message(state.message);
      }, { className: "danger" }),
      action("↑", () => move(index, -1), { unavailable: index === 0, title: `${shop.name}を上へ` }),
      action("↓", () => move(index, 1), { unavailable: index === state.shops.length - 1, title: `${shop.name}を下へ` }),
    );
    row.append(operations); $("#shops").append(row);
  });
  buttons();
}
async function save(shops, cache = {}) {
  state = await api("/api/shops", "PUT", { shops, cache, revision: state.revision });
  render(); message(state.message);
}
async function move(index, direction) {
  const shops = [...state.shops];
  [shops[index], shops[index + direction]] = [shops[index + direction], shops[index]];
  await save(shops);
}
function fields() {
  const shop = Object.fromEntries(keys.map(key => [key, $("#shop-form").elements.namedItem(key).value.trim()]));
  shop.reservationEnabled = $("#shop-form").elements.namedItem("reservationEnabled").checked;
  if (!shop.reservationEnabled) delete shop.reservationUrl;
  return shop;
}
function reservationFields() {
  const enabled = $("#shop-form").elements.namedItem("reservationEnabled").checked;
  $("#reservation-url-field").hidden = !enabled;
  $("#shop-form").elements.namedItem("reservationUrl").required = enabled;
}
function fill(shop) {
  for (const key of keys) $("#shop-form").elements.namedItem(key).value = shop[key] || "";
  $("#shop-form").elements.namedItem("reservationEnabled").checked = !!shop.pageUrl && canReserve(shop);
  reservationFields();
}
function showMetadata() {
  $("#metadata").replaceChildren();
  for (const [key, label] of [["reservationSummary", "予約条件"], ["fetchedAt", "最終取得"]]) {
    if (metadata[key]) $("#metadata").append(element("dt", label), element("dd", metadata[key]));
  }
}
function showEditor(shop) {
  editingId = shop?.id;
  metadata = state.cache[editingId] || {};
  $("#editor-title").textContent = shop ? `${shop.name}を編集` : "店を追加";
  $("#source-url").value = shop ? shopPageUrl(shop) : "";
  $("#resolve").textContent = shop ? "店から取り直す" : "読み込む";
  $("#shop-form").hidden = !shop;
  $("#choice-form").hidden = $("#differences").hidden = true;
  $("#preview-message").textContent = "";
  fill(shop ? { ...shop, pageUrl: shopPageUrl(shop), reservationUrl: reservationPageUrl(shop), reservationEnabled: canReserve(shop), description: shop.description ?? metadata.description ?? "" } : {});
  $("#shop-form").elements.namedItem("id").readOnly = !!shop;
  showMetadata();
  $("#editor").hidden = false;
  $("#editor").scrollIntoView({ behavior: "smooth", block: "start" });
  $("#source-url").focus();
}
async function resolvePreview(networkIndex) {
  if (!editingId) $("#shop-form").hidden = true;
  $("#preview-message").textContent = "店の情報を読み込んでいます…";
  $("#choice-form").hidden = $("#differences").hidden = true;
  let preview;
  try { preview = await api("/api/resolve", "POST", { url: $("#source-url").value, id: editingId, networkIndex }); }
  catch (error) {
    $("#preview-message").textContent = error.message;
    state = await api("/api/shops"); render();
    throw error;
  }
  if (preview.choices) {
    $("#network-choice").replaceChildren(...preview.choices.map(choice => {
      const option = element("option", `${choice.name} · ${choice.description || choice.hocon}`);
      option.value = choice.index; return option;
    }));
    $("#choice-form").hidden = false;
    $("#preview-message").textContent = "エージェントが複数あります。問い合わせ先を選んでください。";
    return;
  }
  metadata = preview.cache;
  $("#preview-message").textContent = preview.warning || "読み込みました。ジャンルなどを確認・編集して保存してください。まだ店舗は保存していません。";
  if (!editingId) fill(preview.shop);
  else {
    const current = fields();
    diffs = Object.entries(labels).filter(([key]) => preview.shop[key] && preview.shop[key] !== current[key]);
    $("#diff-fields").replaceChildren(...diffs.map(([key, label]) => {
      const row = element("label", undefined, "difference");
      const checkbox = element("input"); checkbox.type = "checkbox"; checkbox.value = key;
      checkbox.dataset.value = preview.shop[key];
      row.append(checkbox, element("span", `${label}（変更あり）\n現在: ${current[key] || "未入力"}\n取得: ${preview.shop[key]}`));
      return row;
    }));
    $("#differences").hidden = !diffs.length;
    if (!diffs.length && !preview.warning) $("#preview-message").textContent = "店の情報を取り直しました。変更された項目はありません。保存すると取得日時を記録します。";
  }
  showMetadata(); $("#shop-form").hidden = false;
}

$("#add-shop").addEventListener("click", () => showEditor());
$("#shop-form").elements.namedItem("reservationEnabled").addEventListener("change", reservationFields);
$("#close-editor").addEventListener("click", () => { $("#editor").hidden = true; });
$("#resolve-form").addEventListener("submit", event => { event.preventDefault(); run(() => resolvePreview()); });
$("#choice-form").addEventListener("submit", event => { event.preventDefault(); run(() => resolvePreview(Number($("#network-choice").value))); });
$("#apply-differences").addEventListener("click", () => {
  for (const checkbox of document.querySelectorAll("#diff-fields input:checked")) $("#shop-form").elements.namedItem(checkbox.value).value = checkbox.dataset.value;
  $("#differences").hidden = true;
});
$("#shop-form").addEventListener("submit", event => {
  event.preventDefault();
  run(async () => {
    const shop = fields();
    const shops = editingId ? state.shops.map(item => item.id === editingId ? shop : item) : [...state.shops, shop];
    await save(shops, { [shop.id]: metadata });
    $("#editor").hidden = true;
  });
});
try { sessionStorage.removeItem("gemihub-admin-ai-v1"); } catch { /* Remove obsolete admin-only credentials. */ }
$("#logout").addEventListener("click", () => run(async () => { await api("/api/logout", "POST", {}); location.reload(); }));
$("#invite-form").addEventListener("submit", event => {
  event.preventDefault();
  const form = event.currentTarget;
  const input = Object.fromEntries(new FormData(form));
  run(async () => {
    const result = await api("/api/invitations", "POST", input);
    message(result.message); form.reset();
  });
});
run(async () => {
  const session = await api("/api/session");
  $("#operator-status").textContent = session.user ? `${session.user.email} としてログイン中` : session.setupMessage || "店舗の招待・管理には、運営者のGoogleログインが必要です。";
  $("#google-login").hidden = !!session.user || !session.configured;
  $("#logout").hidden = !session.user;
  $("#add-shop").hidden = $("#registry").hidden = $("#invitations").hidden = !session.user;
  if (session.user) { state = await api("/api/shops"); render(); mountSiteEditor({ api }); }
});

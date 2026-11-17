import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, parseFragment, serialize } from "parse5";
import postcss from "postcss";
import { GUIDE_GREETING, guideGreeting } from "../site/guide-copy.js";

export const codeRoot = fileURLToPath(new URL("../", import.meta.url));
const tags = new Set("a abbr article aside b blockquote br code dd details div dl dt em figcaption figure footer h1 h2 h3 h4 header hr i img li main nav ol p section slot small span strong summary table tbody td th thead time tr ul".split(" "));
const attributes = new Set("id class role title lang dir href target rel src alt width height loading decoding colspan rowspan scope datetime name data-image-id".split(" "));
const copies = ["assistantHeading", "assistantIntro", "shopsHeading", "shopsIntro", "greeting"];
export const designFields = ["title", "description", "html", "css", "copy"];
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
const text = value => ({ nodeName: "#text", value, parentNode: null });
const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
const set = (node, name, value) => { const old = node.attrs.find(a => a.name === name); if (old) old.value = value; else node.attrs.push({ name, value }); };
function walk(node, visit) { visit(node); for (const child of node.childNodes || []) walk(child, visit); }
function find(node, predicate) { let result; walk(node, n => { if (!result && predicate(n)) result = n; }); return result; }
const byId = (node, id) => find(node, n => attr(n, "id") === id);
function content(node, value) { node.childNodes = [text(value)]; node.childNodes[0].parentNode = node; }
const nodeText = node => { let result = ""; walk(node, n => { if (n.nodeName === "#text") result += n.value; }); return result.trim(); };
const outer = node => serialize({ nodeName: "#document-fragment", childNodes: [node] });
function replace(node, replacement) { const parent = node.parentNode; parent.childNodes.splice(parent.childNodes.indexOf(node), 1, replacement); replacement.parentNode = parent; }
async function template(root = codeRoot) { return parse(await readFile(join(root, "src/finder-page.html"), "utf8")); }
function parts(doc) {
  const header = find(doc, n => attr(n, "class") === "site-header");
  return { header, navigation: find(header, n => n.tagName === "nav"), assistant: byId(doc, "assistant"), shops: byId(doc, "registered-shops"), main: byId(doc, "main"), footer: find(doc, n => n.tagName === "footer") };
}
export async function defaultDesign(root = codeRoot) {
  const doc = await template(root), p = parts(doc);
  return {
    title: nodeText(find(doc, n => n.tagName === "title")),
    description: attr(find(doc, n => n.tagName === "meta" && attr(n, "name") === "description"), "content"),
    html: outer(p.header).replace(outer(p.navigation), '<slot name="navigation"></slot>') + "\n" + outer(p.main).replace(outer(p.assistant), '<slot name="assistant"></slot>').replace(outer(p.shops), '<slot name="shops"></slot>') + "\n" + outer(p.footer),
    css: "",
    copy: { assistantHeading: nodeText(byId(doc, "assistant-heading")), assistantIntro: nodeText(p.assistant.childNodes.find(n => n.tagName === "p")), shopsHeading: nodeText(byId(doc, "shops-heading")), shopsIntro: nodeText(p.shops.childNodes.find(n => n.tagName === "p")), greeting: GUIDE_GREETING },
  };
}
export async function validateDesign(input, root = codeRoot) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => !designFields.includes(k))) fail("変更案の形式を確認してください。");
  for (const [key, max] of [["title", 160], ["description", 500], ["html", 60000], ["css", 30000]]) if (typeof input[key] !== "string" || input[key].length > max || (key !== "css" && !input[key].trim())) fail(`変更案の${key}が空か、長すぎます。`);
  if (!input.copy || typeof input.copy !== "object" || Array.isArray(input.copy) || Object.keys(input.copy).some(k => !copies.includes(k)) || copies.some(k => typeof input.copy[k] !== "string" || !input.copy[k].trim() || input.copy[k].length > 1000)) fail("見出し・案内文を確認してください。");
  const original = await template(root), reserved = new Set(); walk(original, n => { if (attr(n, "id")) reserved.add(attr(n, "id")); });
  const fragment = parseFragment(input.html), slots = [], ids = new Set(); let count = 0, mains = 0, heading = 0;
  function inspect(node, depth = 0) {
    if (++count > 2000 || depth > 30) fail("ページの構造が複雑すぎます。");
    if (node.tagName) {
      if (!tags.has(node.tagName) || node.namespaceURI !== "http://www.w3.org/1999/xhtml") fail("変更案には表示用のHTMLだけを使用してください。");
      for (const a of node.attrs) {
        if (a.namespace || (!attributes.has(a.name) && !/^aria-[a-z-]+$/.test(a.name))) fail("スクリプト・独自フォーム・埋め込みは変更案に含められません。");
        if (a.name === "data-image-id" && (node.tagName !== "img" || !/^[a-f0-9]{64}$/.test(a.value) || attr(node, "src") !== undefined)) fail("画像は添付画像のIDで指定してください。");
        if (a.name === "name" && node.tagName !== "slot") fail("name属性はslotだけに使用してください。");
        if (["href", "src"].includes(a.name)) {
          if (/[\x00-\x20\x7f\\]/.test(a.value)) fail("リンクまたは画像URLを確認してください。");
          if (!/^https:\/\//i.test(a.value)) { if (a.name === "src" || !/^(?:\/(?!\/)|\.\/|#[a-zA-Z0-9_-]+$)/.test(a.value)) fail("リンクはHTTPSかサイト内リンクを使用してください。"); }
          else { const url = new URL(a.value); if (url.username || url.password) fail("認証情報を含むURLは使用できません。"); }
        }
        if (a.name === "target" && !["_blank", "_self"].includes(a.value)) fail("リンクの開き方を確認してください。");
      }
      const id = attr(node, "id");
      if (id) { if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(id) || ids.has(id) || (reserved.has(id) && !["main", "hero-title"].includes(id))) fail("検索やチャットの部品はslotで配置し、既存のIDは追加しないでください。"); ids.add(id); }
      if (node.tagName === "main") { mains++; if (id !== "main") fail("本文のmainにはid=mainを残してください。"); }
      if (node.tagName === "h1") heading++;
      if (node.tagName === "slot") {
        const name = attr(node, "name");
        if (!["navigation", "assistant", "shops"].includes(name) || slots.includes(name) || node.childNodes.some(n => n.nodeName !== "#text" || n.value.trim())) fail("navigation・assistant・shopsのslotを1つずつ空で配置してください。");
        if (name !== "navigation") { let parent = node.parentNode; while (parent && parent.tagName !== "main") parent = parent.parentNode; if (!parent) fail("チャットと店舗一覧はmainの中に配置してください。"); }
        slots.push(name);
      }
      if (attr(node, "target") === "_blank") set(node, "rel", "noopener noreferrer");
    }
    for (const child of node.childNodes || []) inspect(child, depth + 1);
  }
  inspect(fragment);
  if (mains !== 1 || heading !== 1 || !ids.has("hero-title") || slots.length !== 3) fail("main・hero-titleの見出しと、navigation・assistant・shopsのslotを残してください。");
  const cleanCss = input.css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (/[\\<>]/.test(input.css) || /(?:url|image-set|expression|paint)\s*\(/i.test(cleanCss)) fail("CSSから外部ファイルやコードは読み込めません。画像はHTMLのimgで指定してください。");
  let css; try { css = postcss.parse(input.css); } catch { fail("スタイルの形式を確認してください。"); }
  css.walkAtRules(rule => { if (!["media", "supports", "container", "keyframes", "-webkit-keyframes", "layer"].includes(rule.name.toLowerCase())) fail("外部CSSやフォントの読み込みは使用できません。"); });
  css.walkDecls(d => { if (/^(?:behavior|-moz-binding)$/i.test(d.prop)) fail("このスタイルは使用できません。"); });
  return { title: input.title, description: input.description, html: serialize(fragment), css: css.toString(), copy: Object.fromEntries(copies.map(k => [k, k === "greeting" ? guideGreeting(input.copy[k]) : input.copy[k]])) };
}
const safety = '\n[hidden]{display:none!important}\nbody[data-shop-view="open"] [data-editor-chrome]{display:none!important}\nbody[data-shop-view="open"] [data-editor-layout]{display:contents!important}\n';
export async function renderDesign(config, root = codeRoot) {
  config = await validateDesign(config, root);
  const doc = await template(root), p = parts(doc), body = find(doc, n => n.tagName === "body"), layout = parseFragment(config.html);
  walk(layout, node => { const id = attr(node, "data-image-id"); if (id) set(node, "src", `./page-images/${id}.webp`); });
  content(find(doc, n => n.tagName === "title"), config.title);
  set(find(doc, n => n.tagName === "meta" && attr(n, "name") === "description"), "content", config.description);
  content(byId(doc, "assistant-heading"), config.copy.assistantHeading); content(p.assistant.childNodes.find(n => n.tagName === "p"), config.copy.assistantIntro);
  content(byId(doc, "shops-heading"), config.copy.shopsHeading); content(p.shops.childNodes.find(n => n.tagName === "p"), config.copy.shopsIntro); set(p.assistant, "data-greeting", config.copy.greeting);
  function mark(node) {
    if (!node.tagName) return;
    const contains = !!find(node, n => n.tagName === "slot" && attr(n, "name") === "assistant");
    if (!contains) set(node, "data-editor-chrome", "");
    else if (node.tagName !== "main" && node.tagName !== "slot") set(node, "data-editor-layout", "");
    for (const child of node.childNodes || []) mark(child);
  }
  layout.childNodes.forEach(mark);
  const slotNodes = []; walk(layout, n => { if (n.tagName === "slot") slotNodes.push(n); });
  for (const slot of slotNodes) { const name = attr(slot, "name"), node = p[name]; if (attr(slot, "data-editor-chrome") !== undefined) set(node, "data-editor-chrome", ""); replace(slot, node); }
  const fixed = body.childNodes.filter(n => attr(n, "class") === "skip-link" || attr(n, "id") === "shop-view-header");
  const noscript = find(body, n => n.tagName === "noscript"); body.childNodes = [...fixed, ...layout.childNodes, noscript].filter(Boolean); body.childNodes.forEach(n => { n.parentNode = body; });
  const css = config.css + safety, cssName = `design-${createHash("sha256").update(css).digest("hex").slice(0, 20)}.css`;
  const link = parseFragment(`<link rel="stylesheet" href="./${cssName}">`).childNodes[0], head = find(doc, n => n.tagName === "head"); head.childNodes.push(link); link.parentNode = head;
  return { html: serialize(doc), css, cssName };
}
export async function atomicFile(path, data, mode = 0o644) {
  await mkdir(join(path, ".."), { recursive: true }); const temp = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temp, data, { mode, flag: "wx" }); await rename(temp, path); }
  catch (error) { await rm(temp, { force: true }); throw error; }
}
export async function applyPublishedDesign({ root, sourceRoot = codeRoot } = {}) {
  let state; try { state = JSON.parse(await readFile(join(root, "admin/site-editor.json"), "utf8")); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  const page = await renderDesign(state.published.config, sourceRoot);
  await atomicFile(join(root, "site", page.cssName), page.css); await atomicFile(join(root, "site/index.html"), page.html);
}
export function designImageIds(config) {
  const ids = []; walk(parseFragment(config.html), node => { const id = attr(node, "data-image-id"); if (id) ids.push(id); }); return [...new Set(ids)];
}
export async function previewDesign(config, shops, root = codeRoot, images) {
  const page = await renderDesign(config, root), doc = parse(page.html);
  if (images) { const nodes = []; walk(doc, node => { if (attr(node, "data-image-id")) nodes.push(node); }); for (const node of nodes) set(node, "src", await images.url(attr(node, "data-image-id"))); }
  const escape = s => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  const app = byId(doc, "agent-app"); app.childNodes = parseFragment(`<div class="ns-chat"><div class="ns-msgs"><div class="ns-msg bot">${escape(guideGreeting(config.copy.greeting))}</div></div><div class="ns-inputbar"><textarea disabled placeholder="街の情報・イベント・お店について相談…"></textarea><button disabled>送信</button></div></div>`).childNodes;
  byId(doc, "shop-list").childNodes = parseFragment(shops.slice(0, 100).map(s => `<article class="shop-card"><span class="eyebrow">${escape(s.area)} / ${escape(s.cuisine)}</span><h3>${escape(s.name)}</h3><p>${escape(s.description || "")}</p><a>店舗サイトを開く ↗</a></article>`).join("")).childNodes;
  content(byId(doc, "shop-count"), String(shops.length)); content(byId(doc, "assistant-status"), "");
  const remove = []; walk(doc, n => { if (["script", "iframe", "noscript"].includes(n.tagName) || n.tagName === "link" && attr(n, "rel") === "stylesheet") remove.push(n); if (n.tagName === "a") n.attrs = n.attrs.filter(a => !["href", "target"].includes(a.name)); if (["button", "input", "textarea", "select"].includes(n.tagName)) set(n, "disabled", ""); });
  for (const n of remove) n.parentNode.childNodes.splice(n.parentNode.childNodes.indexOf(n), 1);
  const previewCss = '#agent-app .ns-chat{display:flex;flex-direction:column;min-height:480px;border:1px solid var(--ns-border);border-radius:12px;color:var(--ns-fg);font-family:var(--ns-font)}#agent-app .ns-msgs{flex:1;padding:20px}#agent-app .ns-msg{background:var(--ns-msgbg);padding:14px;border-radius:12px;white-space:pre-wrap}#agent-app .ns-inputbar{display:flex;gap:8px;padding:12px;border-top:1px solid var(--ns-border)}#agent-app textarea{min-width:0;flex:1;resize:none}#agent-app button{background:var(--ns-primary);color:white}';
  const css = (await Promise.all(["assistant.css", "style.css"].map(f => readFile(join(root, "site", f), "utf8")))).join("\n") + "\n" + previewCss + "\n" + page.css;
  const style = parseFragment('<style></style>').childNodes[0]; content(style, css); find(doc, n => n.tagName === "head").childNodes.push(style);
  return serialize(doc);
}

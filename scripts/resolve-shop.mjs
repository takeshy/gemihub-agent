import { AgentNetwork, parseExternalAgent, validateNetwork } from "../site/runtime/kernel.js";
import { safeName } from "../site/runtime/runner.js";
import { parseHocon } from "../site/runtime/hocon.js";
import { readJsonRpcResponse } from "../site/runtime/mcp.js";
import { validateShops } from "./shops.mjs";

export const messages = {
  url: "HTTPSのURLを入れてください（ローカルは http://127.0.0.1 可）",
  manifest: "このURLにはエージェントの案内（agent-manifest.json）が見つかりません",
  network: "予約用のエージェント（reservation_concierge）が公開されていません",
  mcp: "店の情報を読み込めませんでした。名前などを手で入れて保存できます",
  duplicate: "同じ店がすでに登録されています",
};

export function normalizeShopUrl(value, { production = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new Error(messages.url); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || (production && local)) throw new Error(messages.url);
  url.username = url.password = url.search = url.hash = "";
  return url;
}

export function shopBase(url) {
  const base = new URL(url);
  base.pathname = base.pathname.replace(/\/agent(?:\/.*)?$/, "").replace(/\/reserve\/?$/, "").replace(/\/$/, "");
  return base.href.replace(/\/$/, "");
}

export function inferArea(address) {
  const text = String(address || "").replace(/^〒?\s*\d{3}-?\d{4}\s*/, "").replace(/\s+/g, "");
  const prefecture = text.match(/^(北海道|東京都|京都府|大阪府|.{2,3}県)/)?.[0];
  if (!prefecture) return "";
  const rest = text.slice(prefecture.length);
  const city = rest.match(/^(.+?郡.+?[町村]|.+?[市区町村])/)?.[0] || "";
  return prefecture + city;
}

function slug(base) {
  const url = new URL(base);
  const tail = url.pathname.split("/").filter(Boolean).at(-1);
  return (tail || url.hostname.replace(/^www\./, "")).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "shop";
}

function manifestLink(html) {
  const decode = value => value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const key = entity.slice(1, -1).toLowerCase();
    if (key.startsWith("#")) {
      const code = key[1] === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" }[key];
  });
  for (const tag of html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<link\b[^>]*>/gi)) {
    const attrs = Object.fromEntries([...tag[0].matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(match => [match[1].toLowerCase(), decode(match[2] ?? match[3] ?? match[4])]));
    if (attrs.rel?.toLowerCase().split(/\s+/).includes("agent-manifest") && attrs.href) return attrs.href;
  }
}

// The timeout covers redirects AND consuming the body (including MCP SSE streams).
export function createShopTransport({ fetch: fetchImpl = globalThis.fetch, production = false, timeout = 10000 } = {}) {
  return async (value, options = {}, consume = response => response.json()) => {
    const first = normalizeShopUrl(value, { production });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("通信が10秒以内に完了しませんでした")), timeout);
    try {
      let url = first;
      for (let redirects = 0; redirects <= 5; redirects++) {
        const response = await fetchImpl(url.href, { ...options, redirect: "manual", signal: controller.signal });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          await response.body?.cancel();
          const location = response.headers.get("location");
          if (!location) throw new Error("リダイレクト先がありません");
          const next = normalizeShopUrl(new URL(location, url), { production });
          if (next.origin !== first.origin) throw new Error("別オリジンへのリダイレクトは許可されていません");
          url = next;
          continue;
        }
        if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}: ${url.href}`); }
        return { value: await consume(response), url: url.href };
      }
      throw new Error("リダイレクトが多すぎます");
    } finally { clearTimeout(timer); }
  };
}

export async function resolveShop(input, { shops = [], editingId, networkIndex, production = false, fetch, timeout, now = () => new Date() } = {}) {
  const inputUrl = normalizeShopUrl(input, { production });
  const base = shopBase(inputUrl);
  const request = createShopTransport({ fetch, production, timeout });
  const sameOrigin = (ref, relativeTo) => {
    const url = normalizeShopUrl(new URL(ref, relativeTo), { production });
    if (url.origin !== inputUrl.origin) throw new Error("店と異なるオリジンの接続先は許可されていません");
    return url.href;
  };
  let manifest;
  try { manifest = await request(`${base}/agent/agent-manifest.json`); }
  catch {
    try {
      const page = await request(inputUrl, {}, response => response.text());
      const link = manifestLink(page.value);
      if (!link) throw new Error(messages.manifest);
      manifest = await request(sameOrigin(link, page.url));
    } catch { throw new Error(messages.manifest); }
  }
  const networks = manifest.value?.networks?.filter(entry => entry.name === "reservation_concierge") || [];
  if (!networks.length) throw new Error(messages.network);
  if (networks.length > 1 && networkIndex === undefined) return {
    choices: networks.map((entry, index) => ({ index, name: entry.name, description: entry.description || "", hocon: entry.hocon })),
  };
  const entry = networks[networkIndex ?? 0];
  if (!entry || typeof entry.hocon !== "string" || !entry.hocon) throw new Error(messages.network);
  const networkUrl = sameOrigin("reservation_concierge", manifest.url);
  const networkFile = await request(sameOrigin(entry.hocon, manifest.url), {}, response => response.text());
  const network = new AgentNetwork(parseHocon(networkFile.value), "reservation_concierge");
  const validation = validateNetwork(network);
  if (validation.errors.length) throw new Error(`ネットワーク定義が不正です: ${validation.errors.join("\n")}`);
  if (!entry.front_man || !network.config.tools?.some(tool => tool.name === entry.front_man)) throw new Error("ネットワークの窓口が見つかりません");
  const toolName = safeName(parseExternalAgent(networkUrl, inputUrl.origin).agentName);
  const otherShops = shops.filter(shop => shop.id !== editingId);
  const id = editingId || slug(base);
  if (otherShops.some(shop => shop.id === id || safeName(parseExternalAgent(shop.networkUrl, new URL(shop.networkUrl).origin).agentName) === toolName)
      || ["condition_checker", "finder_front", "render_cruse"].includes(toolName) || toolName.startsWith("website_")) throw new Error(messages.duplicate);

  const shop = { id, name: "", area: "", cuisine: "", pageUrl: `${base}/reserve`, networkUrl };
  const cache = { fetchedAt: now().toISOString(), description: "", reservationSummary: "", status: "needs-review" };
  let warning;
  try {
    // Prefer the actual MCP used by the network; agent-mcp.json may describe an unavailable facade.
    const refs = network.config.tools.flatMap(agent => agent.tools || []);
    let endpoint = refs.find(ref => ref && typeof ref === "object" && typeof ref.url === "string" && (!ref.tools || ref.tools.includes("get_shop_info")))?.url;
    endpoint ||= refs.find(ref => typeof ref === "string" && /(?:\/mcp(?:\/|$)|\/\/mcp\.)/.test(ref));
    if (!endpoint) {
      const declaration = (await request(sameOrigin("agent-mcp.json", manifest.url))).value;
      if (declaration.available === false) throw new Error("MCP unavailable");
      endpoint = declaration.url || declaration.endpoint;
    }
    if (typeof endpoint !== "string" || !endpoint) throw new Error("MCP URL missing");
    endpoint = sameOrigin(endpoint, manifest.url);
    let rpcId = 0;
    let sessionId;
    const rpc = async (method, params, notification = false) => {
      const id = notification ? undefined : ++rpcId;
      const result = await request(endpoint, { method: "POST", headers: {
        "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18",
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
      }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) }, async response => {
        sessionId = response.headers.get("Mcp-Session-Id") || sessionId;
        if (notification) { await response.body?.cancel(); return; }
        const message = await readJsonRpcResponse(response, id);
        if (message.id !== id || message.error) throw new Error(message.error?.message || "Invalid MCP response");
        return message.result;
      });
      return result.value;
    };
    await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "gemihub-agent-admin", version: "0.1.0" } });
    await rpc("notifications/initialized", {}, true);
    const result = await rpc("tools/call", { name: "get_shop_info", arguments: {} });
    if (result?.isError) throw new Error("get_shop_info failed");
    const info = result?.structuredContent || JSON.parse((result?.content || []).filter(part => part.type === "text").map(part => part.text).join("\n"));
    if (typeof info.shop !== "string" || !info.shop.trim()) throw new Error("店名がありません");
    shop.name = info.shop;
    shop.area = inferArea(info.address);
    if (info.reservePageUrl) shop.pageUrl = sameOrigin(info.reservePageUrl, `${base}/`);
    cache.description = typeof info.description === "string" ? info.description : "";
    const reservation = info.reservation;
    cache.reservationSummary = reservation ? [
      reservation.partySize ? `${reservation.partySize.min}〜${reservation.partySize.max}名` : "",
      typeof reservation.seatOnlyAllowed === "boolean" ? `席のみ${reservation.seatOnlyAllowed ? "可" : "不可"}` : "",
    ].filter(Boolean).join("、") : "";
    cache.status = "connected";
  } catch { warning = messages.mcp; }
  // Use the shared validator for all persisted fields, even while a manual preview is incomplete.
  validateShops({ version: 1, shops: [...otherShops, { ...shop, name: shop.name || "未入力", area: shop.area || "未入力", cuisine: "未入力" }] }, { production });
  return { shop, cache, ...(warning ? { warning } : {}) };
}

import { parseExternalAgent } from "../site/runtime/kernel.js";
import { safeName } from "../site/runtime/runner.js";

export function validateShops(config, { production = false } = {}) {
  if (config?.version !== 1 || !Array.isArray(config.shops) || !config.shops.length) throw new Error("shops.json: version:1 と1店以上の shops が必要です。");
  const ids = new Set();
  const tools = new Set(["condition_checker", "finder_front", "render_cruse"]);
  return config.shops.map(shop => {
    for (const key of ["id", "name", "area", "cuisine", "pageUrl", "networkUrl"]) {
      if (typeof shop[key] !== "string" || !shop[key].trim()) throw new Error(`shops.json: ${key} が必要です。`);
    }
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(shop.id) || ids.has(shop.id)) throw new Error(`shops.json: 不正または重複したid ${shop.id}`);
    ids.add(shop.id);
    const urls = [shop.pageUrl, shop.networkUrl].map(value => {
      const url = new URL(value);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) || (production && local)) throw new Error(`公開URLはHTTPS、HTTPはループバックのみ: ${value}`);
      if (url.username || url.password || url.search || url.hash) throw new Error("登録URLに認証情報・クエリ・フラグメントは使用できません。");
      if (url.href !== value || !url.pathname.split("/").at(-1) || /[%\s]/.test(url.pathname)) throw new Error(`正規化したページ/ネットワークURLを指定してください: ${value}`);
      return url;
    });
    if (urls[0].origin !== urls[1].origin) throw new Error("店ページとネットワークは同じオリジンにしてください。");
    const tool = safeName(parseExternalAgent(shop.networkUrl, urls[1].origin).agentName);
    if (tools.has(tool) || tool.startsWith("website_")) throw new Error(`ネットワークのツール名が衝突します: ${tool}`);
    tools.add(tool);
    return Object.fromEntries(["id", "name", "area", "cuisine", "pageUrl", "networkUrl"].map(key => [key, shop[key]]).concat([["networkTool", tool]]));
  });
}

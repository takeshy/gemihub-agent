function decode(value = "") {
  return value.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[\da-f]+);/gi, entity => {
    const key = entity.slice(1, -1).toLowerCase();
    if (key.startsWith("#")) {
      const code = key[1] === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " }[key];
  });
}
const text = value => typeof value === "string" ? decode(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim() : "";
function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map(match => [match[1].toLowerCase(), decode(match[2] ?? match[3] ?? match[4])]));
}

export function extractShopPage(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  const meta = {};
  for (const match of html.matchAll(/<meta\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)) {
    const attrs = attributes(match[0]);
    const key = (attrs.property || attrs.name || "").toLowerCase();
    if (key && attrs.content && !Object.hasOwn(meta, key)) meta[key] = attrs.content;
  }
  const objects = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (attributes(match[1]).type?.toLowerCase() !== "application/ld+json") continue;
    try {
      const parsed = JSON.parse(match[2]);
      for (const value of Array.isArray(parsed) ? parsed : [parsed]) {
        if (value && typeof value === "object") objects.push(value, ...(Array.isArray(value["@graph"]) ? value["@graph"] : []));
      }
    } catch { /* Metadata is optional; never execute page scripts. */ }
  }
  const shop = objects.slice(0, 200).find(item => [item?.["@type"]].flat().some(type => typeof type === "string" && /(?:Store|Shop|LocalBusiness|HairSalon|NailSalon|Organization|Restaurant|CafeOrCoffeeShop|Service)$/.test(type))) || {};
  const address = typeof shop.address === "string" ? shop.address : [shop.address?.postalCode ? `〒${shop.address.postalCode}` : "", shop.address?.addressRegion, shop.address?.addressLocality, shop.address?.streetAddress].filter(item => typeof item === "string").join("");
  return {
    name: text(shop.name || meta["og:site_name"] || meta["og:title"] || html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]).slice(0, 200),
    description: text(shop.description || meta.description || meta["og:description"]).slice(0, 2000),
    address: text(address),
  };
}

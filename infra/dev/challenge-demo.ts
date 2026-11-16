import type { ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createApp } from "../../apps/shop/server/app.ts";
import { appSite, storefrontAssistant } from "../../apps/shop/server/agentic.ts";
import { sample, shopSchema } from "../../apps/shop/server/domain.ts";
import { origin } from "../../apps/shop/server/auth.ts";
import { Store, type Shop } from "../../apps/shop/server/store.ts";
import { seedRestaurantDemo } from "../../apps/shop/scripts/seed-restaurant-demo.ts";
import { decorateRestaurant } from "./challenge-theme.ts";
import { renderChallengeRetail } from "./challenge-retail.ts";

// Recovered from the former challenge demo image. The database and mail sink are isolated from dev accounts.
export async function createChallengeDemo() {
  if (process.env.DEMO_MODE !== "true" || process.env.NODE_ENV === "production") throw new Error("Challenge demo requires isolated DEMO_MODE=true and non-production NODE_ENV");
  for (const value of [process.env.APP_ORIGIN, process.env.AGENT_PARENT_URL]) {
    if (!value || new URL(value).origin !== value) throw new Error("Challenge demo requires explicit app and parent origins");
  }
  const shopOrigin = origin();
  const demoArea = "神奈川県横浜市港北区大倉山";
  const store = new Store(":memory:");
  const { shops: restaurants } = await seedRestaurantDemo(store);
  const restaurantSlugs = new Set(restaurants);
  for (const shop of await store.list<Shop>("shop")) {
    if (!shop.published?.seating) throw new Error(`Missing seating configuration for ${shop.slug}`);
    shop.published.address = `${demoArea}（架空のデモ店舗）`;
    decorateRestaurant(shop.published, shop.slug);
    shop.published.description += " 予約体験用の架空店舗です。氏名と電話番号はテスト用の値を入力してください。";
    shop.published.seating.confirmationCall = false;
    shop.published = shopSchema.parse(shop.published);
    shop.published.header.imageUrl = `${shopOrigin}/s/${shop.slug}/demo-photo.webp`;
    await store.saveShop(shop);
  }

  const retail = {
    name: "文具と器 こまど",
    area: demoArea,
    hours: "土曜 12:00〜21:00",
    products: ["作家の器", "手帳", "紙雑貨", "贈り物用の文具"],
  };
  const retailBase = "/s/komado";
  const agentBase = `${retailBase}/agent`;
  const photos = new Map(await Promise.all([
    ...[...restaurants, "komado"].map(slug => [`/s/${slug}/demo-photo.webp`, `${slug}.webp`]),
    [`${retailBase}/okurayama.webp`, "okurayama.webp"],
  ].map(async ([path, file]) => [path, await readFile(new URL(`./challenge-assets/${file}`, import.meta.url))] as const)));
  const retailConfig = shopSchema.parse({ ...structuredClone(sample), name: retail.name, industry: "other",
    description: `作家の器、手帳、紙雑貨、贈り物用の文具を扱う架空のデモ店舗。`, address: demoArea,
    products: retail.products, menus: [], staff: [], ownerBooking: true,
    hours: { start: "12:00", end: "21:00", closedWeekdays: [0, 1, 2, 3, 4, 5], holidays: [] },
  });
  await store.saveShop({ id: "challenge-komado", slug: "komado", owner: "komado-owner@example.com",
    published: retailConfig, publication: "public", draft: null, revision: 1, history: [] });
  const guide = storefrontAssistant({ slug: "komado", config: retailConfig }, appSite(shopOrigin, "komado"));
  function json(res: ServerResponse, value: unknown) {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(value));
  }
  const retailPage = renderChallengeRetail(retailBase, retail, guide);

  // Run the real restaurant booking flow with an in-memory database and a mail sink.
  const demoMail = async () => {};
  const server = createApp(store, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, demoMail);
  const [serveRestaurant] = server.listeners("request");
  server.removeListener("request", serveRestaurant as (...args: unknown[]) => void);
  server.removeAllListeners("upgrade");
  server.on("request", (req, res) => {
    const path = (req.url || "").split("?")[0];
    const read = req.method === "GET" || req.method === "HEAD";
    if (read && path === "/healthz") return json(res, { ok: true, shops: [...restaurantSlugs, "komado"] });
    const photo = read ? photos.get(path) : undefined;
    if (photo) {
      res.writeHead(200, { "Content-Type": "image/webp", "Content-Length": photo.byteLength, "Cache-Control": "public, max-age=3600" });
      res.end(req.method === "HEAD" ? undefined : photo);
      return;
    }
    if (read && (path === retailBase || path === `${retailBase}/`)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": guide.csp });
      res.end(req.method === "HEAD" ? undefined : retailPage);
      return;
    }
    if (path.startsWith(`${agentBase}/`) && (read || path === `${agentBase}/mcp` && (req.method === "POST" || req.method === "OPTIONS"))) {
      serveRestaurant(req, res);
      return;
    }
    const page = /^\/s\/([a-z-]+)(?:\/|$)/.exec(path);
    const api = /^\/api\/public\/([a-z-]+)(?:\/(seats|bookings))?$/.exec(path);
    const mcp = page && path.endsWith("/agent/mcp") && (req.method === "POST" || req.method === "OPTIONS");
    const booking = api?.[2] === "bookings" && req.method === "POST";
    if (page && restaurantSlugs.has(page[1]) && (read || mcp) || api && restaurantSlugs.has(api[1]) && (read || booking)) {
      if (booking && req.headers.origin !== shopOrigin) { res.writeHead(403); res.end(); return; }
      serveRestaurant(req, res);
      return;
    }
    res.writeHead(404); res.end();
  });
  server.once("close", () => { void store.close(); });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3010);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid demo port");
  const server = await createChallengeDemo();
  server.listen(port, "0.0.0.0", () => console.log(`Challenge demo stores listening on port ${port}`));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => server.close(() => process.exit(0)));
}

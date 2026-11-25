import { isArchivedShop, type Shop, type Store } from "./store.ts";
import { shopNetworkName, supportsShopAgent } from "./agentic.ts";
import { takesBookings } from "./domain.ts";

export function parentListingEnabled() {
  return !!process.env.PARENT_SHOPS_URL && (process.env.PARENT_INTEGRATION_SECRET || "").length >= 32;
}

export function parentListingPending(shop: Shop) {
  return !shop.judge && (isArchivedShop(shop)
    ? shop.parentListing === "pending" || shop.parentListing === "listed"
    : shop.parentListing === "pending" && shop.publication === "public" && !!shop.published);
}

/** Called after the shop commit and retried by the minute worker. Reset and publish share this shop lock. */
export async function syncParentListing(store: Store, shopId: string) {
  if (!parentListingEnabled()) return;
  await store.locked(shopId, async () => {
    const shop = await store.get<Shop>("shop", shopId);
    if (!shop || !parentListingPending(shop)) return;
    const target = new URL(process.env.PARENT_SHOPS_URL!);
    if (target.username || target.password || (target.protocol !== "https:" &&
      !(target.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)))) {
      throw new Error("PARENT_SHOPS_URL must use HTTPS or loopback HTTP");
    }
    const remove = isArchivedShop(shop);
    const config = shop.published!;
    const identity = { shopId: shop.id, slug: shop.slug };
    const entry = remove ? identity : {
      ...identity, name: config.name, address: config.address.slice(0, 500), description: config.description.slice(0, 2000),
      industry: config.industry, reservations: takesBookings(config),
      network: supportsShopAgent(config) ? shopNetworkName(config) : "",
    };
    const response = await fetch(target, {
      method: remove ? "DELETE" : "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.PARENT_INTEGRATION_SECRET}` },
      body: JSON.stringify(entry),
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Town directory returned HTTP ${response.status}`);
    await store.saveShop({ ...shop, parentListing: remove ? "removed" : "listed" });
  });
}

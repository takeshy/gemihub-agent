import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createApp } from "../server/app.ts";
import { digest } from "../server/auth.ts";
import { sample } from "../server/domain.ts";
import { syncParentListing } from "../server/parent-registry.ts";
import { Store, type Shop, type User } from "../server/store.ts";

test("public release joins the town, retries a failed listing and removes only its own entry on reset", { timeout: 15000 }, async t => {
  const { initializeParent } = await import(new URL("../../../infra/dev/init-parent.mjs", import.meta.url).href);
  const { createAdminServer } = await import(new URL("../../../admin/server.mjs", import.meta.url).href);
  const { createShopStore } = await import(new URL("../../../admin/store.mjs", import.meta.url).href);
  const root = await mkdtemp(join(tmpdir(), "gemihub-town-listing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initializeParent({ root });

  const listen = async (server: Server) => {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  const store = new Store(":memory:");
  t.after(() => store.close());
  const origin = await listen(createApp(store));
  const secret = randomUUID();
  const adminStore = createShopStore({ root });
  let rejectFirst = true, attempted = false;
  const adminOrigin = await listen(createAdminServer({
    root, auth: null, integrationSecret: secret, shopOrigin: origin,
    store: { ...adminStore, save: async (...args: Parameters<typeof adminStore.save>) => {
      if (rejectFirst) {
        rejectFirst = false;
        attempted = true;
        throw Object.assign(new Error("Temporary listing failure"), { status: 503 });
      }
      return adminStore.save(...args);
    } },
  }));
  const env = { APP_ORIGIN: origin, PARENT_SHOPS_URL: adminOrigin + "/api/internal/shops", PARENT_INTEGRATION_SECRET: secret, DEMO_MODE: "true" };
  for (const [key, value] of Object.entries(env)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const until = async (predicate: () => Promise<boolean> | boolean) => {
    for (let i = 0; i < 100; i++) {
      if (await predicate()) return;
      await delay(25);
    }
    assert.fail("Timed out waiting for town listing");
  };

  const shop = await store.createShop("owner@example.com");
  shop.published = { ...sample, name: "ひかり文具", description: "紙と文具のお店", address: "東京都台東区", industry: "other", reservationsEnabled: false, menus: [], staff: [] };
  shop.publication = "provisional";
  await store.saveShop(shop);
  const owner: User = { email: shop.owner, role: "owner", name: "Owner", shopId: shop.id };
  await store.put("user", owner.email, owner);
  const session = randomUUID();
  await store.put("session", digest(session), { user: owner, expires: Date.now() + 3600000 });
  const api = (path: string, data?: unknown) => fetch(origin + path, {
    method: data === undefined ? "GET" : "POST", headers: { Origin: origin, Cookie: `gemihub_session=${session}`, "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });

  const base = `/api/shops/${shop.id}`;
  const preview = await (await api(`${base}/publication-preview`)).json();
  assert.equal(preview.publication, "provisional");
  assert.deepEqual((await adminStore.get()).shops, []);
  const publication = await api(`${base}/publication`, { publication: "public", revision: preview.revision, hash: preview.hash });
  assert.equal(publication.status, 200, await publication.text());
  await until(() => attempted);
  assert.equal((await store.shop(shop.id))?.parentListing, "pending");
  assert.deepEqual((await adminStore.get()).shops, []);
  await syncParentListing(store, shop.id);
  const listed = await adminStore.get();
  assert.equal(listed.shops.length, 1);
  const [entry] = listed.shops;
  assert.equal(entry.name, shop.published.name);
  assert.equal(entry.area, "東京都台東区");
  assert.equal(entry.pageUrl, `${origin}/s/${shop.slug}`);
  assert.equal(entry.networkUrl, `${entry.pageUrl}/agent/shop_guide`);
  assert.equal(entry.reservationEnabled, false);
  assert.equal(entry.reservationUrl, undefined);
  assert.equal(listed.cache[entry.id].publishedShopId, shop.id);
  assert.match(await readFile(join(root, "site/shop-registry.js"), "utf8"), /ひかり文具/);

  const manual = { id: "manual", name: "運営が登録したお店", area: "東京", cuisine: "書店", pageUrl: origin + "/s/manual/" };
  await adminStore.save([...listed.shops, manual], {}, listed.revision);
  const internal = (method: string, slug: string, key: string = secret) => fetch(env.PARENT_SHOPS_URL, {
    method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ shopId: shop.id, slug, name: "別名", industry: "other", description: "", address: "", reservations: false, network: "shop_guide" }),
  });
  assert.equal((await internal("POST", shop.slug, "wrong-secret")).status, 403);
  assert.equal((await internal("POST", "../elsewhere")).status, 400);
  assert.equal((await internal("POST", "manual")).status, 200);
  assert.equal((await internal("DELETE", "manual")).status, 200);
  assert.deepEqual((await adminStore.get()).shops, [entry, manual]);

  const reset = await api("/api/shop-reset", { shopId: shop.id });
  assert.equal(reset.status, 200);
  await until(async () => (await store.get<Shop>("shop", shop.id))?.parentListing === "removed");
  assert.deepEqual((await adminStore.get()).shops, [manual]);
  assert.equal((await fetch(entry.pageUrl)).status, 404);
});

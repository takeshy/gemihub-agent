// Real local HTTP flows and GCS-compatible memory storage; Google OAuth and Gmail are fixtures.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { createAdminServer } from "../admin/server.mjs";
import { createGoogleAuth } from "../admin/google-auth.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const scratch = await mkdtemp(join(tmpdir(), "shop-auth-browser-"));
const results = join(root, "test-results");
process.chdir(join(root, "apps/shop"));
const [{ createApp }, { Store }, { shopStorage }, { chromium }] = await Promise.all([
  import("../apps/shop/server/app.ts"), import("../apps/shop/server/store.ts"), import("../apps/shop/server/shop-storage.ts"), import(process.env.PLAYWRIGHT_MODULE || "playwright"),
]);
const store = new Store(":memory:"), errors = [], mail = [];
const secret = "browser-shared-secret-".repeat(3);
process.env.PARENT_INTEGRATION_SECRET = secret;
delete process.env.ACCESS_PASSWORD;
const auth = createGoogleAuth({ root: scratch, env: { GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: "fixture-secret", PARENT_ADMIN_EMAILS: "operator@example.com", PARENT_AUTH_SECRET: "browser-encryption-key-".repeat(3) }, oauthFactory: redirect => ({
  generateAuthUrl(args) { const url = new URL("https://oauth.fixture.test/authorize"); url.searchParams.set("redirect_uri", redirect); url.searchParams.set("state", args.state); return url.href; },
  async getToken() { return { tokens: { id_token: "fixture", refresh_token: "fixture-operator-token", scope: "openid email profile https://www.googleapis.com/auth/gmail.send" } }; },
  async verifyIdToken() { return { getPayload: () => ({ email_verified: true, email: "operator@example.com" }) }; },
  setCredentials() {},
}), send: async (_client, message) => {
  const mime = Buffer.from(message.requestBody.raw, "base64url").toString();
  mail.push({ mime, text: Buffer.from(mime.split("\r\n\r\n").at(-1), "base64").toString() });
} });
let parent, shopServer, browser, page;
try {
  await mkdir(results, { recursive: true });
  const downloadsPath = join(root, "tmp/storage-auth-downloads"); await mkdir(downloadsPath, { recursive: true });
  await mkdir(join(scratch, "site"));
  await writeFile(join(scratch, "site/shops.json"), await readFile(join(root, "site/shops.json")));
  shopServer = createApp(store);
  await new Promise(resolve => shopServer.listen(0, "127.0.0.1", resolve));
  const shopOrigin = `http://127.0.0.1:${shopServer.address().port}`; process.env.APP_ORIGIN = shopOrigin;
  parent = createAdminServer({ root: scratch, auth, integrationSecret: secret, shopOrigin: shopOrigin });
  await new Promise(resolve => parent.listen(0, "127.0.0.1", resolve));
  const parentOrigin = `http://localhost:${parent.address().port}`;
  process.env.PARENT_MAIL_URL = `http://127.0.0.1:${parent.address().port}/api/internal/mail`;
  assert.equal((await fetch(parentOrigin + "/api/shops")).status, 401);
  browser = await chromium.launch({ headless: true, downloadsPath, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: "ja-JP" });
  await context.route("https://oauth.fixture.test/**", async route => {
    const url = new URL(route.request().url()), target = new URL(url.searchParams.get("redirect_uri"));
    target.searchParams.set("state", url.searchParams.get("state")); target.searchParams.set("code", "fixture");
    await route.fulfill({ contentType: "text/html", body: `<title>Google OAuth fixture</title><a id="fixture-google-consent" href="${target.href.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">Google認証を続ける（テスト）</a>` });
  });
  page = await context.newPage(); page.setDefaultTimeout(20000); page.on("pageerror", error => errors.push(error.message));
  await page.goto(parentOrigin);
  await page.locator("#google-login").waitFor({ state: "visible" });
  assert.equal(await page.locator("#registry").isVisible(), false);
  await page.locator("#google-login").click();
  await page.locator("#fixture-google-consent").click();
  await page.locator("#invitations").waitFor({ state: "visible" });
  assert.match(await page.locator("#operator-status").innerText(), /operator@example.com/);
  await page.locator('#invite-form [name="email"]').fill("shop-owner@example.com");
  await page.locator('#invite-form [name="name"]').fill("森の小さなお店");
  await page.locator('#invite-form [name="industry"]').selectOption("restaurant");
  await page.getByRole("button", { name: "招待メールを送る", exact: true }).click();
  await page.getByText("招待メールを送りました。", { exact: true }).waitFor();
  assert.equal(mail.length, 1); assert.equal((await store.list("shop")).length, 0);
  await page.screenshot({ path: join(results, "parent-invitation-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(results, "parent-invitation-mobile.png"), fullPage: true });
  const invitation = mail[0].text.match(/http:\/\/[^\s]+/)[0];
  const owner = await context.newPage(); owner.setDefaultTimeout(20000); owner.on("pageerror", error => errors.push(error.message));
  await owner.goto(invitation);
  await owner.getByRole("button", { name: "このメールアドレスでログイン", exact: true }).waitFor();
  assert.ok(!owner.url().includes("owner-login="));
  await owner.screenshot({ path: join(results, "shop-email-confirmation.png"), fullPage: true });
  await owner.getByRole("button", { name: "このメールアドレスでログイン", exact: true }).click();
  await owner.waitForFunction(async () => (await (await fetch("/api/session")).json()).user?.role === "owner");
  const [shop] = await store.list("shop"); assert.equal(shop.owner, "shop-owner@example.com"); assert.equal(shop.draft.name, "森の小さなお店");
  assert.equal((await owner.evaluate(async () => (await (await fetch("/api/session")).json()).user)).authMethod, "owner-email");
  // Publish a fixture without AI, and include an actual private attachment in the export.
  const files = shopStorage(store);
  shop.published = { ...shop.draft, map: { enabled: false, query: "" } }; shop.draft = null; shop.publication = "public";
  shop.storage = await files.provision(shop, shop.published, "");
  await files.syncConfig(shop, shop.published, ""); await store.saveShop(shop);
  const [fileId] = await files.customerFiles.reserve(1, "");
  await files.customerFiles.upload(shop, "", fileId, { name: "添付.txt", mimeType: "text/plain", data: Buffer.from("exported file bytes").toString("base64") });
  await owner.goto(shopOrigin + "/?tab=settings");
  const exportLink = owner.locator('a[href$="export?format=zip"]'); await exportLink.waitFor();
  const download = await Promise.all([owner.waitForEvent("download"), exportLink.click()]).then(values => values[0]);
  assert.equal(await download.failure(), null);
  const exportPath = join(results, "shop-data-export.zip"); await download.saveAs(exportPath);
  const bytes = await readFile(exportPath), entries = new Map(); let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18), nameLength = bytes.readUInt16LE(offset + 26), extra = bytes.readUInt16LE(offset + 28), start = offset + 30 + nameLength + extra;
    entries.set(bytes.subarray(offset + 30, offset + 30 + nameLength).toString(), inflateRawSync(bytes.subarray(start, start + size))); offset = start + size;
  }
  assert.ok(entries.has("shop.json")); assert.ok(entries.has("web/index.html")); assert.ok(entries.has("files/index.json"));
  assert.equal([...entries].find(([path]) => path.endsWith("/添付.txt"))[1].toString(), "exported file bytes");
  assert.ok(!entries.get("shop.json").toString().includes("fixture-operator-token"));
  assert.equal(await owner.locator('a[href*="drive.google.com"]').count(), 0);
  await owner.screenshot({ path: join(results, "shop-cloud-export.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log("Browser checks passed: operator Google login, Gmail invitation relay, explicit shop email confirmation, owner session, private files in ZIP, desktop/mobile. OAuth and Gmail were fixtures; no real email or model was used.");
} catch (error) {
  if (page) {
    const url = new URL(page.url()); console.error("Browser location:", url.origin + url.pathname);
    console.error("Page:", (await page.locator("body").innerText()).slice(0, 500));
    await page.screenshot({ path: join(results, "storage-auth-failure.png"), fullPage: true });
  }
  throw error;
} finally {
  await browser?.close();
  for (const server of [parent, shopServer]) if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await store.close(); await rm(scratch, { recursive: true, force: true });
}

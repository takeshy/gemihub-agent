// Run inside the dev app container, with the shop's working directory and runtime identity.
// node --max-old-space-size=256 --import tsx /app/infra/dev/smoke.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Store } from "../../apps/shop/server/store.ts";
import { bucketStorefrontFiles } from "../../apps/shop/server/storefront-files.ts";
import { chromium } from "playwright";

assert.equal(process.env.FIRESTORE_DATABASE_ID, "gemihub-dev", "This probe is for the isolated dev database only");
assert.equal(process.env.STOREFRONT_BUCKET, `${process.env.GOOGLE_CLOUD_PROJECT}-gemihub-dev-files`);
assert.equal(process.env.APP_ORIGIN, "https://shop.dev.gemihub.net");
const id = randomUUID(), path = `_deployment-check/${id}.txt`, data = Buffer.from("GemiHub isolated dev check");
const store = new Store(), files = bucketStorefrontFiles(), result = {};
let browser;
try {
  await store.put("deploymentCheck", id, { id });
  assert.equal((await store.get("deploymentCheck", id)).id, id); result.firestore = true;
  await files.write(path, data, "text/plain");
  assert.deepEqual(await files.read(path), data); result.cloudStorage = true;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  const response = await page.goto(process.env.APP_ORIGIN, { waitUntil: "networkidle", timeout: 60000 });
  assert.equal(response.status(), 200); result.chromium = true;
  result.containerWithProbeAndBrowserMiB = Math.round(Number(await readFile("/sys/fs/cgroup/memory.current", "utf8")) / 1048576);
} finally {
  await browser?.close();
  try { await files.remove(path); }
  finally { try { await store.delete("deploymentCheck", id); } finally { await store.close(); } }
}
console.log(JSON.stringify(result));

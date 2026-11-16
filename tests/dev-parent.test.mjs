import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeParent } from "../infra/dev/init-parent.mjs";

test("dev starts without local demo shops and redeploys preserve its registry and private Gmail state", async t => {
  const root = await mkdtemp(join(tmpdir(), "gemihub-dev-parent-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initializeParent({ root });
  assert.deepEqual(JSON.parse(await readFile(join(root, "site/shops.json"), "utf8")), { version: 1, shops: [] });
  assert.deepEqual(JSON.parse(await readFile(join(root, "site/agent-manifest.json"), "utf8")).allowed_peers, []);
  const config = JSON.stringify({ version: 1, shops: [{ id: "stationery", name: "文具店", area: "東京", cuisine: "文具", pageUrl: "https://stationery.example/", reservationEnabled: false }] }) + "\n";
  await writeFile(join(root, "site/shops.json"), config);
  await mkdir(join(root, "admin"));
  await writeFile(join(root, "admin/auth.json"), "private-fixture-state");
  const documents = JSON.stringify({ version: 1, documents: [{ id: "local", name: "地域.txt", text: "公開済み資料" }] });
  await writeFile(join(root, "site/chat-documents.json"), documents);
  await writeFile(join(root, "admin/chat-documents.json"), "private-document-state");
  await initializeParent({ root });
  assert.equal(await readFile(join(root, "site/shops.json"), "utf8"), config);
  assert.equal(await readFile(join(root, "admin/auth.json"), "utf8"), "private-fixture-state");
  assert.equal(await readFile(join(root, "site/chat-documents.json"), "utf8"), documents);
  assert.equal(await readFile(join(root, "admin/chat-documents.json"), "utf8"), "private-document-state");
  const registry = await readFile(join(root, "site/shop-registry.js"), "utf8");
  assert.match(registry, /stationery\.example/);
  assert.doesNotMatch(registry, /127\.0\.0\.1|localhost/);
});

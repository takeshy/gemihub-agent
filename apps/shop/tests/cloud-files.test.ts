import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, inflateRawSync } from "node:zlib";
import { shopStorage } from "../server/shop-storage.ts";
import { storageDesignVersions } from "../server/storage-versions.ts";
import { Store } from "../server/store.ts";
import { sample } from "../server/domain.ts";
import { zip } from "../server/zip.ts";
import { google } from "googleapis";
import { Readable } from "node:stream";
import { bucketStorefrontFiles, memoryStorefrontFiles } from "../server/storefront-files.ts";
import { migrateDriveStorage } from "../server/migrate-drive-storage.ts";
import { encrypt } from "../server/google.ts";

test("Cloud Storage writes use server credentials, private objects and the appropriate overwrite preconditions", async t => {
  const values = new Map<string, Buffer>(), writes: Record<string, unknown>[] = [];
  t.mock.method(google, "storage", ((config: { auth: unknown }) => {
    assert.ok(config.auth instanceof google.auth.GoogleAuth);
    return { objects: {
      async insert(input: { name: string; bucket: string; ifGenerationMatch?: string; requestBody: { cacheControl: string }; media: { body: Readable } }) {
        writes.push(input as unknown as Record<string, unknown>); assert.equal(input.bucket, "private-shop-files"); assert.equal(input.requestBody.cacheControl, "private, no-store");
        if (input.ifGenerationMatch === "0" && values.has(input.name)) throw Object.assign(new Error("exists"), { code: 412 });
        const chunks: Buffer[] = []; for await (const chunk of input.media.body) chunks.push(Buffer.from(chunk)); values.set(input.name, Buffer.concat(chunks));
      },
      async get(input: { object: string }) { if (!values.has(input.object)) throw Object.assign(new Error("missing"), { code: 404 }); return { data: values.get(input.object) }; },
      async delete(input: { object: string }) { values.delete(input.object); },
    } };
  }) as never);
  const mutable = bucketStorefrontFiles("private-shop-files", false);
  await mutable.write("shop/files", "first", "text/plain"); await mutable.write("shop/files", "second", "text/plain");
  assert.equal((await mutable.read("shop/files"))!.toString(), "second"); assert.equal(writes[1].ifGenerationMatch, undefined);
  const immutable = bucketStorefrontFiles("private-shop-files"); await immutable.write("release/page", "first", "text/html"); await immutable.write("release/page", "ignored", "text/html");
  assert.equal((await immutable.read("release/page"))!.toString(), "first"); assert.equal(writes[2].ifGenerationMatch, "0");
  await mutable.remove("shop/files"); assert.equal(await mutable.read("shop/files"), undefined);
});

test("Drive migration resumes after failure, keeps file IDs and archives, and never changes the source", async t => {
  const store = new Store(":memory:"); t.after(() => store.close());
  const shop = await store.createShop("migration@example.com"); shop.published = structuredClone(sample);
  shop.google = { folderId: "root", specId: "spec", historyId: "history", artifactIds: { "web/index.html": "index" } }; await store.saveShop(shop);
  const records = [
    { id: "root", name: "shop", mimeType: "application/vnd.google-apps.folder", parents: [], content: "" },
    ...["spec", "history", "index", "data", "shop-json", "mock"].map(id => ({ id, name: id, mimeType: "text/plain", parents: ["root"], content: `content-${id}` })),
    { id: "image", name: "photo.png", mimeType: "image/png", parents: ["root"], content: "binary content" },
    { id: "manifest", name: "manifest.json", mimeType: "application/json", parents: ["root"], content: JSON.stringify({ design: { appearance: sample.appearance, screens: sample.screens, pages: sample.pages, header: sample.header, footer: sample.footer }, files: { "web/index.html": "index", "web/data.js": "data", "web/shop.json": "shop-json", "web/mock.json": "mock" } }) },
  ];
  let reads = 0;
  t.mock.method(google, "drive", (() => ({ files: {
    async get(input: { fileId: string; alt?: string }) { reads++; const file = records.find(file => file.id === input.fileId)!; return { data: input.alt === "media" ? Buffer.from(file.content) : file }; },
    async list(input: { q: string }) { return { data: { files: records.filter(file => file.parents.includes(input.q.match(/^'([^']+)'/)![1])) } }; },
  } })) as never);
  const memory = memoryStorefrontFiles(store); let failed = false;
  const destination = shopStorage(store, { ...memory, async write(path, ...args) { if (path.endsWith("/image") && !failed) { failed = true; throw new Error("temporary storage failure"); } await memory.write(path, ...args); } });
  await assert.rejects(migrateDriveStorage(store, shop, encrypt("old-refresh"), destination), /temporary/);
  assert.equal((await store.shop(shop.id))!.storage, undefined);
  assert.equal((await migrateDriveStorage(store, shop, encrypt("old-refresh"), destination)).migrated, true);
  const migrated = (await store.shop(shop.id))!, before = reads;
  assert.equal(migrated.storage!.artifactIds!["web/index.html"], "index");
  assert.equal((await destination.read(migrated, "image")).toString(), "binary content");
  const restored = await storageDesignVersions(migrated, destination).read({ number: 1, at: "now", summary: "legacy", folderId: "root", manifestId: "manifest" });
  assert.equal(restored.files["web/data.js"], "content-data"); assert.equal(reads, before, "migrated files and versions never call Drive");
  assert.equal(records[2].content, "content-history");
});

test("Cloud-backed shop files need no owner token and enforce shop ownership, replay integrity and cleanup", async t => {
  const store = new Store(":memory:"); t.after(() => store.close());
  const files = shopStorage(store), shop = await store.createShop("cloud@example.com"), other = await store.createShop("other@example.com");
  shop.storage = await files.provision(shop, sample, ""); await store.saveShop(shop);
  await files.syncConfig(shop, sample, "");
  assert.equal(shop.google, undefined); assert.equal(shop.storage.provider, "gcs");
  assert.match(await files.readText(shop, shop.storage.specId), /お店|shop/i);
  assert.match(await files.readText(shop, shop.storage.artifactIds!["web/index.html"]), /<html/);
  const [id] = await files.customerFiles.reserve(1, "");
  const file = { name: "notes.txt", mimeType: "text/plain", data: Buffer.from("private content").toString("base64") };
  await files.customerFiles.upload(shop, "", id, file);
  await files.customerFiles.upload(shop, "", id, file);
  await assert.rejects(files.customerFiles.upload(shop, "", id, { ...file, data: Buffer.from("changed").toString("base64") }));
  await assert.rejects(files.read(other, id));
  await files.customerFiles.rename(shop, "", id, "renamed.txt");
  assert.equal((await files.read(shop, id)).toString(), "private content");
  assert.equal((await files.entries(other)).length, 0);
  await files.remove(shop, id); await files.remove(shop, id);
  await assert.rejects(files.read(shop, id));
  await assert.rejects(files.read(shop, "../other"));
});

test("design archives read only their own shop's objects and keep the complete restorable snapshot", async t => {
  const store = new Store(":memory:"); t.after(() => store.close());
  const files = shopStorage(store), shop = await store.createShop("version@example.com"), other = await store.createShop("other@example.com");
  shop.published = structuredClone(sample); shop.storage = await files.provision(shop, sample, ""); await files.syncConfig(shop, sample, "");
  const versions = storageDesignVersions(shop, files);
  const archived = await versions.capture(shop, { number: 1, at: new Date().toISOString(), summary: "initial" });
  const version = { ...archived!, number: 1, at: new Date().toISOString(), summary: "initial" };
  const snapshot = await versions.read(version);
  assert.ok(snapshot.files["web/index.html"]); assert.ok(snapshot.files["web/data.js"]);
  await assert.rejects(storageDesignVersions(other, files).read(version));
  await versions.trash(version); await assert.rejects(versions.read(version));
});

test("download archives use standard ZIP CRCs, UTF-8 names and include binary bytes without path traversal", async () => {
  const chunks: Buffer[] = [];
  for await (const chunk of zip([{ name: "資料/説明.txt", data: "123456789" }, { name: "photo.bin", data: Buffer.from([0, 255, 128, 1]) }])) chunks.push(chunk);
  const data = Buffer.concat(chunks);
  let offset = 0; const contents = new Map<string, Buffer>();
  while (data.readUInt32LE(offset) === 0x04034b50) {
    const size = data.readUInt32LE(offset + 18), nameLength = data.readUInt16LE(offset + 26), extraLength = data.readUInt16LE(offset + 28);
    assert.equal(data.readUInt16LE(offset + 6), 0x800);
    const start = offset + 30 + nameLength + extraLength, decoded = inflateRawSync(data.subarray(start, start + size));
    assert.equal(crc32(decoded), data.readUInt32LE(offset + 14));
    contents.set(data.subarray(offset + 30, offset + 30 + nameLength).toString(), decoded); offset = start + size;
  }
  assert.equal(contents.get("資料/説明.txt")!.toString(), "123456789"); assert.deepEqual(contents.get("photo.bin"), Buffer.from([0, 255, 128, 1]));
  assert.equal(data.readUInt32LE(data.length - 22), 0x06054b50); assert.equal(data.readUInt16LE(data.length - 12), 2);
  await assert.rejects(async () => { for await (const _ of zip([{ name: "../private", data: "no" }])) {} });
});

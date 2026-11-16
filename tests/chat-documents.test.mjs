import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChatDocuments, createDocumentImporter } from "../admin/chat-documents.mjs";
import { searchDocuments, searchChatDocuments } from "../site/chat-documents.js";
import { createAdminServer } from "../admin/server.mjs";

const encode = text => Buffer.from(text).toString("base64");
const importer = createDocumentImporter();
const draft = { name: "図書館.md", text: "中央図書館の開館時間は午前9時から午後6時です。休館日は毎週月曜日です。", published: false };
async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "parent-documents-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, store: createChatDocuments({ root, ...options }), publicData: async () => JSON.parse(await readFile(join(root, "site/chat-documents.json"), "utf8")) };
}

test("text imports preserve source content and reject binary, malformed, oversized or unsupported files", async () => {
  assert.deepEqual(await importer({ name: "地域のお知らせ.txt", data: encode("\ufeff図書館\r\n月曜日は休館です。") }), { name: "地域のお知らせ.txt", text: "図書館\n月曜日は休館です。" });
  for (const extension of ["md", "csv", "json"]) assert.equal((await importer({ name: `案内.${extension}`, data: encode("公民館 受付9時") })).text, "公民館 受付9時");
  for (const input of [
    { name: "../secret.txt", data: encode("秘密") }, { name: "image.png", data: encode("data") },
    { name: "binary.txt", data: encode("\x00not text") }, { name: "empty.txt", data: encode("  ") },
    { name: "bad.txt", data: "//==" }, { name: "bad.txt", data: Buffer.from([0xff, 0xff]).toString("base64") },
    { name: "long.txt", data: encode("あ".repeat(100001)) }, { name: "bad.pdf", data: encode("plain text") },
  ]) await assert.rejects(importer(input));
  await assert.rejects(importer({ name: "large.txt", data: "A".repeat(8 * 1024 * 1024) }), { status: 413 });
  await assert.rejects(importer({ name: "test.pdf", data: encode("%PDF-1.7 fixture") }), { status: 503 });
});

test("PDF extraction uses only the operator's Gemini key and rejects partial and failed output", async () => {
  const data = encode("%PDF-1.7 fixture");
  let request;
  const read = createDocumentImporter({ apiKey: "private-fixture-key", fetch: async (url, options) => {
    request = { url, ...options };
    return Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ thought: true, text: "private thought" }, { text: "公民館は9時に開館します。" }] } }] });
  } });
  assert.equal((await read({ name: "施設案内.pdf", data })).text, "公民館は9時に開館します。");
  assert.equal(request.headers["x-goog-api-key"], "private-fixture-key");
  const payload = JSON.parse(request.body);
  assert.equal(payload.contents[0].parts[0].inlineData.data, data);
  assert.ok(!request.body.includes("private-fixture-key"));
  for (const response of [new Response("error", { status: 500 }), Response.json({ candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "incomplete" }] } }] }), Response.json({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "private-fixture-key" }] } }] })]) {
    const failed = createDocumentImporter({ apiKey: "private-fixture-key", fetch: async () => response });
    await assert.rejects(failed({ name: "施設案内.pdf", data }), { status: 502 });
  }
});

test("drafts stay private; publish, editing, unpublish, delete and restart preserve the right sources", async t => {
  const { root, store, publicData } = await fixture(t);
  let state = await store.get();
  state = await store.save({ ...draft, revision: state.revision });
  assert.deepEqual((await publicData()).documents, []);
  if (process.platform !== "win32") assert.equal((await stat(join(root, "admin/chat-documents.json"))).mode & 0o777, 0o600);
  const id = state.documents[0].id;
  state = await store.save({ ...draft, id, published: true, revision: state.revision });
  const publicDocs = (await publicData()).documents;
  assert.deepEqual(Object.keys(publicDocs[0]).sort(), ["id", "name", "text", "updatedAt"]);
  assert.equal(searchDocuments(publicDocs, "図書館は何時に開館しますか").results[0].source, draft.name);
  const reopened = createChatDocuments({ root });
  assert.deepEqual(await reopened.get(), state);
  const oldRevision = state.revision;
  state = await store.save({ ...draft, id, published: true, text: "中央図書館は午前10時開館です。", revision: state.revision });
  assert.match((await publicData()).documents[0].text, /10時/);
  await assert.rejects(store.delete(id, oldRevision), { status: 409 });
  state = await store.save({ ...draft, id, revision: state.revision });
  assert.deepEqual((await publicData()).documents, []);
  assert.equal(state.documents.length, 1);
  state = await store.delete(id, state.revision);
  assert.deepEqual(state.documents, []);
});

test("an original PDF is readable only while published and is linked from its search result", async t => {
  const { root, store, publicData } = await fixture(t);
  const pdf = Buffer.from("%PDF-1.7 original fixture");
  const doc = { ...draft, name: "図書館.pdf" };
  let state = await store.get();
  await assert.rejects(store.save({ ...doc, revision: state.revision, pdf: encode("invalid") }), { status: 400 });
  state = await store.save({ ...doc, revision: state.revision, pdf: pdf.toString("base64") });
  const { id, hasPdf } = state.documents[0];
  assert.equal(hasPdf, true);
  assert.equal("pdf" in state.documents[0], false);
  const asset = join(root, "site/chat-document-files", id + ".pdf");
  await assert.rejects(readFile(asset), { code: "ENOENT" });
  assert.deepEqual((await publicData()).documents, []);
  const reopened = createChatDocuments({ root });
  state = await reopened.save({ ...doc, id, published: true, revision: state.revision });
  assert.deepEqual(await readFile(asset), pdf);
  const docs = (await publicData()).documents;
  assert.equal("pdf" in docs[0], false);
  assert.ok(searchDocuments(docs, "図書館").results[0].pdfUrl.endsWith("/chat-document-files/" + id + ".pdf"));
  state = await reopened.save({ ...doc, id, revision: state.revision });
  await assert.rejects(readFile(asset), { code: "ENOENT" });
  state = await reopened.save({ ...doc, id, published: true, revision: state.revision });
  assert.deepEqual(await readFile(asset), pdf);
  await reopened.delete(id, state.revision);
  await assert.rejects(readFile(asset), { code: "ENOENT" });
});

test("concurrent saves reject stale revisions and failed publication restores private and public state", async t => {
  const { root, store, publicData } = await fixture(t);
  const revision = (await store.get()).revision;
  const results = await Promise.allSettled([store.save({ ...draft, revision }), store.save({ ...draft, name: "別の案内.txt", revision })]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.find(r => r.status === "rejected").reason.status, 409);
  const before = await store.get();
  const broken = createChatDocuments({ root, write: async (path, bytes, options) => {
    const { atomicWrite } = await import("../admin/store.mjs");
    await atomicWrite(path, bytes, options);
    if (path === join(root, "site/chat-documents.json")) throw new Error("disk failure");
  } });
  await assert.rejects(broken.save({ ...draft, id: before.documents[0].id, published: true, revision: before.revision }), /disk failure/);
  assert.deepEqual(await store.get(), before);
  assert.deepEqual((await publicData()).documents, []);
  await assert.rejects(store.save({ ...draft, revision: before.revision }), /同じ名前/);
});

test("search returns bounded Japanese and English excerpts with attribution and distinguishes unavailable sources", async () => {
  const documents = [{ id: "library", name: draft.name, text: draft.text, updatedAt: "2026-11-16" }, { id: "events", name: "イベント.txt", text: "季節の催し\n".repeat(1000) + "防災訓練は12月4日、集合場所は中央公園です。", updatedAt: "2026-11-16" }];
  const result = searchDocuments(documents, "防災訓練", 1);
  assert.equal(result.results.length, 1); assert.equal(result.results[0].sourceId, "events");
  assert.match(result.results[0].text, /12月4日/); assert.ok(result.results[0].text.length <= 1500);
  assert.deepEqual(searchDocuments(documents, "xyz123unknown").results, []);
  assert.equal(searchDocuments([{ id: "en", name: "Guide.txt", text: "Library opens at 9 AM." }], "library").results.length, 1);
  assert.throws(() => searchDocuments(documents, "", 5));
  assert.throws(() => searchDocuments(documents, "図書館", 9));
  let calls = 0;
  const fetch = async (_url, options) => { calls++; assert.equal(options.cache, "no-cache"); return Response.json({ version: 1, documents: calls === 1 ? documents : [] }); };
  assert.equal((await searchChatDocuments({ query: "図書館" }, { fetch })).results.length, 1);
  assert.deepEqual((await searchChatDocuments({ query: "図書館" }, { fetch })).results, []);
  assert.equal((await searchChatDocuments({ query: "図書館" }, { fetch: async () => new Response("", { status: 404 }) })).documentCount, 0);
  assert.equal((await searchChatDocuments({ query: "図書館" }, { fetch: async () => new Response("", { status: 500 }) })).ok, false);
});

test("document management APIs require operator auth and same-origin mutations", async t => {
  const { root } = await fixture(t);
  let user = null;
  const server = createAdminServer({ root, auth: { session: async () => user }, geminiApiKey: "" });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const put = (data, from = origin) => fetch(origin + "/api/chat-documents", { method: "PUT", headers: { "Content-Type": "application/json", Origin: from }, body: JSON.stringify(data) });
  assert.equal((await fetch(origin + "/api/chat-documents")).status, 401);
  assert.equal((await put({})).status, 401);
  user = { email: "operator@example.com" };
  const state = await (await fetch(origin + "/api/chat-documents")).json();
  assert.equal((await put({ ...draft, revision: state.revision }, "https://evil.example")).status, 403);
  const imported = await fetch(origin + "/api/chat-documents/import", { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ name: draft.name, data: encode(draft.text) }) });
  assert.equal(imported.status, 200);
  assert.deepEqual((await (await fetch(origin + "/api/chat-documents")).json()).documents, []);
  assert.equal((await put({ ...draft, revision: state.revision })).status, 200);
  assert.equal((await fetch(origin + "/chat-documents.json")).status, 404);
  assert.equal((await fetch(origin + "/chat-documents-ui.js")).status, 200);
});

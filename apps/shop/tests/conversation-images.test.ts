import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Store } from "../server/store.ts";
import { createApp } from "../server/app.ts";
import { sample } from "../server/domain.ts";
import { contentHash } from "../server/editor-sync.ts";
import { memoryCustomerFiles } from "../server/customer-files.ts";
import { uploadMenuImage } from "../server/menu-images.ts";
import type { RequestImage } from "../server/request-images.ts";
import { createConversation, appendChatMessage } from "../server/shop-chat.ts";
import { finalDetailsQuestion, initialFeatureQuestion } from "../server/request-intent.ts";
import type { ImageUpload } from "../server/menu-images.ts";

process.env.DEMO_MODE = "true";
const image = { mimeType: "image/png" as const, data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" };

test("images attached earlier in a chat reach later AI replies and the change plan; removed ones are skipped", async t => {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com");
  shop.published = structuredClone(sample); shop.publication = "public"; await store.saveShop(shop);
  await store.put("session", createHash("sha256").update("owner").digest("hex"), { user: { email: shop.owner, name: "Owner", role: "owner", shopId: shop.id }, expires: Date.now() + 3600000 });
  const files = memoryCustomerFiles(store);
  const sampleImage = await uploadMenuImage(store, shop, { ...image, name: "見本ページ.png", requestId: randomUUID() }, files, "");
  const removed = await uploadMenuImage(store, shop, { ...image, name: "削除予定.png", requestId: randomUUID() }, files, "");
  const seen: { question?: string[][]; plan?: string[] } = { question: [] };
  const server = createApp(store, {
    propose: async (_text, current, _email, _demo, images: RequestImage[] = []) => { seen.plan = images.map(item => item.id); return { config: { ...current!, description: "見本の雰囲気に合わせた紹介文" }, summary: ["お店の紹介を更新"] }; },
    proposeArticle: async () => { throw new Error("unused"); },
    identifyVisual: async () => { throw new Error("unused"); },
    explainSystem: async (_question, _config, _demo, context) => { seen.question!.push((context?.images || []).map(item => item.id)); return { answer: "見本の雰囲気に合わせますね。", changeRequest: true, ready: true }; },
  }, undefined, files);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = base;
  t.after(async () => { server.close(); await store.close(); });
  const post = async (path: string, data: unknown) => {
    const response = await fetch(`${base}/api/shops/${shop.id}/${path}`, { method: "POST", headers: { Origin: base, Cookie: "gemihub_session=owner", "Content-Type": "application/json" }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  };
  const chat = (await post("conversations", { intent: "modify", requestId: randomUUID(), begin: true })).body as { id: string };
  const context = { revision: shop.revision, hash: contentHash(shop.published) };
  const first = randomUUID();
  assert.equal((await post("system/question", { question: "こういうページにしたい", intent: "modify", imageIds: [sampleImage.imageId, removed.imageId], ...context, chat: { id: chat.id, requestId: first } })).status, 200);
  // The removed image must not break the rest of the conversation.
  await store.put("menuImageUpload", removed.imageId, { ...(await store.get<Record<string, unknown>>("menuImageUpload", removed.imageId)), archived: true });
  const second = randomUUID();
  assert.equal((await post("system/question", { question: "あとはお任せします", intent: "modify", imageIds: [], ...context, chat: { id: chat.id, requestId: second } })).status, 200);
  assert.deepEqual(seen.question, [[sampleImage.imageId, removed.imageId], [sampleImage.imageId]], "a later reply still sees the sample image");
  const plan = await post("plan", { text: "あとはお任せします", intent: "modify", imageIds: [], context, chat: { id: chat.id, requestId: second } });
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  assert.deepEqual(seen.plan, [sampleImage.imageId], "the plan sees the sample attached earlier, not only the last message's images");
});

test("initial feature selection skips earlier image downloads while visual follow-ups and final generation retain them", async t => {
  const store = new Store(":memory:");
  const shop = await store.createShop("owner@example.com", {country: "US", timeZone: "America/New_York"});
  await store.put("session", createHash("sha256").update("owner").digest("hex"), {user: {email: shop.owner, name: "Owner", role: "owner", shopId: shop.id}, expires: Date.now() + 3600000});
  const files = memoryCustomerFiles(store);
  const reference = await uploadMenuImage(store, shop, {...image, name: "参考.png", requestId: randomUUID()}, files, "");
  // Give the original a cold cache entry, so the test observes actual file downloads.
  const [fileId] = await files.reserve(1, "");
  await files.upload(shop, "", fileId, {name: "参考.png", ...image});
  const record = (await store.get<ImageUpload>("menuImageUpload", reference.imageId))!;
  await store.put("menuImageUpload", reference.imageId, {...record, fileId});
  const reads = mock.method(files, "read");
  const chat = await createConversation(store, shop, shop.owner, "create-shop", randomUUID());
  await appendChatMessage(store, shop, chat, {role: "user", text: "店名は月のアトリエ。ネイルサロンです。ロゴはなし。参考画像の雰囲気にしたい。", requestId: randomUUID(), detail: {imageIds: [reference.imageId]}});
  await appendChatMessage(store, shop, chat, {role: "assistant", text: initialFeatureQuestion, requestId: randomUUID()});
  let calls = 0;
  let planImages: RequestImage[] = [];
  const server = createApp(store, {
    propose: async (_text, _config, _email, _demo, images = []) => {
      planImages = images; return {config: structuredClone(sample), summary: ["お店を作成"]};
    },
    proposeArticle: async () => { throw new Error("unused"); },
    identifyVisual: async () => { throw new Error("unused"); },
    explainSystem: async (_question, _config, _demo, context) => {
      calls++;
      assert.equal(context?.initialSetup, true);
      assert.deepEqual(context?.images || [], []);
      assert.deepEqual(context?.availableImageIds, [reference.imageId]);
      assert.equal(context?.facts?.name, "月のアトリエ");
      assert.equal(context?.region?.country, "US");
      assert.deepEqual(context?.relatedHistory, []);
      await assert.rejects(context!.loadImages!(["f".repeat(64)]), {status: 404});
      if (calls === 2) {
        assert.equal(reads.mock.callCount(), 0);
        const pixels = await context!.loadImages!([reference.imageId]);
        assert.equal(pixels[0].data, image.data);
        await context!.loadImages!([reference.imageId]);
        assert.equal(reads.mock.callCount(), 1, "the same original is read only once per request");
      }
      return {answer: calls < 3 ? finalDetailsQuestion : "画面案を作成します。", changeRequest: true, ready: true};
    },
  }, undefined, files);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.APP_ORIGIN = base;
  t.after(async () => { server.close(); await store.close(); });
  const post = async (path: string, data: unknown) => {
    const response = await fetch(`${base}/api/shops/${shop.id}/${path}`, {method: "POST", headers: {Origin: base, Cookie: "gemihub_session=owner", "Content-Type": "application/json"}, body: JSON.stringify(data)});
    return {status: response.status, body: await response.json()};
  };
  const ask = (question: string, requestId = randomUUID(), imageIds: string[] = []) => post("system/question", {question, intent: "create-shop", imageIds, revision: shop.revision, chat: {id: chat.id, requestId}});
  const selection = await ask("1と3。スタッフ紹介は一人分だけ。");
  assert.equal(selection.status, 200, JSON.stringify(selection.body));
  assert.equal(selection.body.ready, false, "the final clarification still gates generation");
  assert.equal(reads.mock.callCount(), 0, "a simple feature selection does not fetch earlier pixels");
  assert.equal((await ask("前の画像の色を使ってください。")).status, 200);
  const finalId = randomUUID();
  const final = await ask("ほかはありません。", finalId);
  assert.equal(final.status, 200, JSON.stringify(final.body));
  assert.equal(final.body.ready, true);
  const plan = await post("plan", {text: "ほかはありません。", intent: "create-shop", chat: {id: chat.id, requestId: finalId}, imageIds: [], context: {revision: shop.revision, hash: contentHash(null)}});
  assert.equal(plan.status, 200, JSON.stringify(plan.body));
  assert.deepEqual(planImages.map(item => ({id: item.id, data: item.data})), [{id: reference.imageId, data: image.data}], "final generation still receives the original reference");
  const unknown = await ask("この画像を使って", randomUUID(), ["f".repeat(64)]);
  assert.equal(unknown.status, 404, "new attachment IDs are validated before calling the model");
  assert.equal(calls, 3);
});

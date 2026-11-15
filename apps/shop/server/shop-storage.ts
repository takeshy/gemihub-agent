import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import type { drive_v3 } from "googleapis";
import { serviceName } from "../shared/brand.ts";
import { tr } from "../shared/i18n.ts";
import { artifacts } from "./artifacts.ts";
import { documents, type ShopConfig } from "./domain.ts";
import type { ReleaseScope } from "./pages.ts";
import type { ScreenId } from "../shared/screens.ts";
import type { Shop, Store } from "./store.ts";
import { isArchivedShop } from "./store.ts";
import { forEachConcurrent } from "./concurrency.ts";
import { bucketStorefrontFiles, memoryStorefrontFiles, type StorefrontFiles } from "./storefront-files.ts";
import type { CustomerFiles } from "./customer-files.ts";
import { customerFileLimit } from "./customers.ts";

type Metadata = { shopId: string; id: string; name?: string | null; mimeType?: string | null; parents?: string[] | null; appProperties?: Record<string, string> | null; size?: number; trashed?: boolean; hash?: string };
const missing = () => Object.assign(new Error(tr("ファイルがありません")), { status: 404, code: 404 });
const objectId = (value: string) => {
  if (!/^[a-zA-Z0-9_-]{1,200}$/.test(value)) throw missing();
  return value;
};
/** Metadata lives in Firestore; file bytes are private, shop-scoped Cloud Storage objects. */
export function shopStorage(store: Store, objects: StorefrontFiles = store.memory ? memoryStorefrontFiles(store) : bucketStorefrontFiles(process.env.SHOP_FILES_BUCKET || process.env.STOREFRONT_BUCKET, false)) {
  const key = (shop: Shop, id: string) => createHash("sha256").update(`${shop.id}:${objectId(id)}`).digest("hex");
  const path = (shop: Shop, id: string) => `shop-files/${objectId(shop.id)}/${objectId(id)}`;
  const metadata = async (shop: Shop, id: string) => {
    if (isArchivedShop(shop)) throw missing();
    const file = await store.get<Metadata>("shopFile", key(shop, id));
    if (!file || file.shopId !== shop.id || file.trashed) throw missing();
    return file;
  };
  const bytes = async (shop: Shop, id: string) => {
    const file = await metadata(shop, id);
    const result = await objects.read(path(shop, id));
    if (!result) throw missing();
    if (file.hash && createHash("sha256").update(result).digest("hex") !== file.hash) throw Object.assign(new Error(tr("保存ファイルが変更されています")), { status: 409 });
    return result;
  };
  const remove = async (shop: Shop, id: string) => {
    let file: Metadata;
    const stored = await store.get<Metadata>("shopFile", key(shop, id));
    if (!stored || stored.shopId !== shop.id || stored.trashed) return;
    file = stored;
    for (const { value: child } of await store.entries<Metadata>("shopFile")) if (child.shopId === shop.id && !child.trashed && child.parents?.includes(id)) await remove(shop, child.id);
    await objects.remove(path(shop, id));
    await store.put("shopFile", key(shop, id), { ...file, trashed: true });
  };
  const repository = (shop: Shop) => ({ files: {
    async create(params: drive_v3.Params$Resource$Files$Create) {
      if (isArchivedShop(shop)) throw missing();
      const fields = params.requestBody || {};
      const id = objectId(fields.id || randomUUID());
      const old = await store.get<Metadata>("shopFile", key(shop, id));
      const chunks: Buffer[] = [];
      if (params.media?.body !== undefined) for await (const chunk of typeof params.media.body === "string" ? [Buffer.from(params.media.body)] : params.media.body) chunks.push(Buffer.from(chunk));
      const data = Buffer.concat(chunks);
      const hash = createHash("sha256").update(data).digest("hex");
      if (old) {
        if (old.trashed || old.hash !== hash || old.name !== fields.name || JSON.stringify(old.appProperties) !== JSON.stringify(fields.appProperties)) throw Object.assign(new Error(tr("ファイルが変更されています")), { code: 409 });
        return { data: old };
      }
      for (const parent of fields.parents || []) await metadata(shop, parent);
      const file: Metadata = { shopId: shop.id, id, name: fields.name, mimeType: params.media?.mimeType || fields.mimeType, parents: fields.parents, appProperties: fields.appProperties, size: data.length, hash };
      await objects.write(path(shop, id), data, file.mimeType || "application/octet-stream");
      await store.put("shopFile", key(shop, id), file);
      return { data: file };
    },
    async update(params: drive_v3.Params$Resource$Files$Update) {
      const id = objectId(params.fileId!);
      if (params.requestBody?.trashed) { await remove(shop, id); return { data: { id } }; }
      const file = await metadata(shop, id);
      if (params.media?.body !== undefined) {
        const chunks: Buffer[] = [];
        for await (const chunk of typeof params.media.body === "string" ? [Buffer.from(params.media.body)] : params.media.body) chunks.push(Buffer.from(chunk));
        const data = Buffer.concat(chunks);
        await objects.write(path(shop, id), data, params.media.mimeType || file.mimeType || "application/octet-stream");
        file.hash = createHash("sha256").update(data).digest("hex"); file.size = data.length;
      }
      if (params.addParents) { await metadata(shop, params.addParents); file.parents = [params.addParents]; }
      if (params.requestBody?.name !== undefined) file.name = params.requestBody.name;
      await store.put("shopFile", key(shop, id), file);
      return { data: file };
    },
    async get(params: drive_v3.Params$Resource$Files$Get, options?: { responseType?: string; maxContentLength?: number }) {
      if (params.alt !== "media") return { data: await metadata(shop, params.fileId!) };
      const data = await bytes(shop, params.fileId!);
      if (options?.maxContentLength && data.length > options.maxContentLength) throw new Error(tr("ファイルが大きすぎます"));
      return { data: options?.responseType === "text" ? data.toString("utf8") : data };
    },
  } });
  const customerFiles: CustomerFiles = {
    async reserve(count) { return Array.from({ length: count }, () => randomUUID()); },
    async upload(shop, _token, id, file) {
      const content = Buffer.from(file.data, "base64");
      if (content.length > customerFileLimit) throw new Error(tr("ファイルが大きすぎます"));
      await repository(shop).files.create({ requestBody: { id, name: file.name, mimeType: file.mimeType }, media: { mimeType: file.mimeType, body: Readable.from([content]) } });
    },
    read: (shop, _token, id) => bytes(shop, id),
    async rename(shop, _token, id, name) { await repository(shop).files.update({ fileId: id, requestBody: { name } }); },
  };
/** Creates a logical folder in the shop-scoped object repository. */
async function createFolder(shop: Shop, name: string, parent?: string) {
  const drive = repository(shop);
  const folder = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", ...(parent ? { parents: [parent] } : {}) },
    fields: "id",
  });
  return folder.data.id!;
}
/** Reads a stored document from Cloud Storage. */
async function readText(shop: Shop, id: string) {
  const drive = repository(shop);
  const response = await drive.files.get({ fileId: id, alt: "media" }, { responseType: "text" });
  return String(response.data ?? "");
}
/** Removes a stored file or folder. Missing files are already gone. */
async function trashFile(shop: Shop, id: string) {
  const drive = repository(shop);
  try { await drive.files.update({ fileId: id, requestBody: { trashed: true }, fields: "id" }); }
  catch (error) { if ((error as { code?: number }).code !== 404) throw error; }
}
async function provision(shop: Shop, config: ShopConfig, token: string, parent?: string) {
  const drive = repository(shop);
  if (shop.storage) return shop.storage;
  if (shop.google) throw Object.assign(new Error(tr("以前のDriveファイルをCloud Storageへ移行してから保存してください。")), { status: 503 });
  const folder = await drive.files.create({
    requestBody: {
      name: `${config.name} — ${serviceName}`,
      mimeType: "application/vnd.google-apps.folder",
      ...(parent ? { parents: [parent] } : {}),
    },
    fields: "id",
  });
  const make = async (name: string) =>
    (
      await drive.files.create({
        requestBody: { name, parents: [folder.data.id!] },
        media: { mimeType: "text/markdown", body: Readable.from([""]) },
        fields: "id",
      })
    ).data.id!;
  return {
    provider: "gcs" as const,
    folderId: folder.data.id!,
    specId: await make("spec.md"),
    historyId: await make("history.md"),
  };
}
async function syncShopDocuments(shop: Shop, config: ShopConfig, token: string) {
  if (!shop.storage) throw new Error(tr("ファイルの保存先が未作成です"));
  const drive = repository(shop);
  const doc = documents(config, shop.history);
  await Promise.all([
    drive.files.update({ fileId: shop.storage.specId, media: { mimeType: "text/markdown", body: Readable.from([doc.spec]) } }),
    drive.files.update({ fileId: shop.storage.historyId, media: { mimeType: "text/markdown", body: Readable.from([doc.history]) } }),
  ]);
}
async function syncConfig(
  shop: Shop,
  config: ShopConfig,
  token: string,
  onProgress: () => void | Promise<void> = () => {},
  scope?: ReleaseScope | { kind: "screen"; screen: ScreenId } | { kind: "menus" },
  menuImages?: Record<string, import("./menu-image-domain.ts").MenuImageData>,
) {
  if (!shop.storage) throw new Error(tr("ファイルの保存先が未作成です"));
  const connection = shop.storage;
  const drive = repository(shop);
  // Prepare the runnable export before writing any remote data.
  const allGenerated = artifacts(config, await readFile("dist/index.html", "utf8"), undefined, menuImages);
  await syncShopDocuments(shop, config, token);
  const selectedPage = scope?.kind === "page" ? config.pages.find(p => p.id === scope.pageId) : undefined;
  const previousPage = scope?.kind === "page" ? shop.published?.pages.find(p => p.id === scope.pageId) : undefined;
  // A page's URL and navigation label are also rendered into the shared exported header.
  const pageNavigationChanged = scope?.kind === "page" && (previousPage?.slug !== selectedPage?.slug || previousPage?.navigationLabel !== selectedPage?.navigationLabel);
  // These are one published snapshot, including after a page/part-only release.
  const snapshotPaths = ["web/index.html", "web/data.js", "web/shop.json", "web/mock.json"];
  const generated = scope?.kind === "menus"
    ? Object.fromEntries(Object.entries(allGenerated).filter(([path]) => snapshotPaths.includes(path) || path === "admin/system.svg"))
    : scope?.kind === "screen"
    ? Object.fromEntries(Object.entries(allGenerated).filter(([path]) => snapshotPaths.includes(path)))
    : scope?.kind === "part"
    ? Object.fromEntries(Object.entries(allGenerated).filter(([path]) => snapshotPaths.includes(path) || [`web/parts/${scope.part}.html`, `web/parts/${scope.part}.json`].includes(path)))
    : scope?.kind === "page" ? Object.fromEntries(Object.entries(allGenerated).filter(([path]) => snapshotPaths.includes(path) || path === "web/pages/index.json" || pageNavigationChanged && path === "web/parts/header.html" || selectedPage && [ `web/pages/${selectedPage.slug}.html`, `web/pages/${selectedPage.slug}.json` ].includes(path))) : allGenerated;
  const ids = connection.artifactIds ||= {};
  const folders = connection.artifactFolders ||= {};
  for (const folder of (scope?.kind === "menus" ? ["web", "admin"] : scope?.kind === "screen" ? ["web"] : scope?.kind === "part" ? ["web", "web/parts"] : scope?.kind === "page" ? ["web", "web/pages", ...(pageNavigationChanged ? ["web/parts"] : [])] : ["web", "admin", "web/pages", "web/parts"])) {
    if (!folders[folder]) {
      folders[folder] = (
        await drive.files.create({
          requestBody: {
            name: folder,
            mimeType: "application/vnd.google-apps.folder",
            parents: [folder.includes("/") ? folders[folder.slice(0, folder.lastIndexOf("/"))] : connection.folderId],
          },
          fields: "id",
        })
      ).data.id!;
      await onProgress();
    }
  }
  // Only newly allocated IDs need checkpoints. Serialize checkpoints while uploading independently.
  let checkpoint = Promise.resolve();
  const progress = () => checkpoint = checkpoint.then(async () => { await onProgress(); });
  await forEachConcurrent(Object.entries(generated), 4, async ([path, content]) => {
    const id = ids[path];
    const mimeType = path.endsWith(".html")
      ? "text/html"
      : path.endsWith(".svg")
        ? "image/svg+xml"
        : path.endsWith(".json")
          ? "application/json"
          : path.endsWith(".js")
            ? "text/javascript"
          : "text/markdown";
    if (id)
      await drive.files.update({
        fileId: id,
        media: { mimeType, body: Readable.from([content]) },
      });
    else {
      ids[path] = (
        await drive.files.create({
          requestBody: {
            name: path.split("/").at(-1)!,
            parents: [
              path.includes("/")
                ? folders[path.slice(0, path.lastIndexOf("/"))]
                : connection.folderId,
            ],
          },
          media: { mimeType, body: Readable.from([content]) },
          fields: "id",
        })
      ).data.id!;
      await progress();
    }
  });
  for (const [path, id] of Object.entries(ids)) {
    if (scope?.kind !== "menus" && scope?.kind !== "part" && scope?.kind !== "screen" && path.startsWith("web/pages/") && !(path in allGenerated) && (scope?.kind !== "page" || previousPage && [ `web/pages/${previousPage.slug}.html`, `web/pages/${previousPage.slug}.json` ].includes(path))) {
      await drive.files.update({ fileId: id, requestBody: { trashed: true } });
      delete ids[path];
      await onProgress();
    }
  }
}
async function syncPostFiles(
  shop: Shop,
  posts: import("./post-domain.ts").Post[],
  token: string,
  onProgress: () => void | Promise<void>,
  readMenuImages?: (config: ShopConfig) => Promise<Record<string, import("./menu-image-domain.ts").MenuImageData>>,
  draftId?: string,
) {
  if (!shop.storage || !shop.published) return;
  posts = posts.filter(post => !post.deletedAt);
  const drive = repository(shop);
  const config = shop.published;
  const draft = draftId ? posts.find(post => post.id === draftId) : undefined;
  if (draftId && !draft) return;
  const files: Record<string, string> = draft ? {
    "admin/posts/posts.json": JSON.stringify(posts, null, 2),
    [`admin/posts/${draft.id}.md`]: `# ${draft.draft.title}\n\n${draft.draft.body}\n`,
  } : (await import("./post-renderer.tsx")).postArtifacts(
    config,
    posts,
    await readFile("dist/index.html", "utf8"),
    readMenuImages ? await readMenuImages(config) : undefined,
  );
  const connection = shop.storage;
  connection.artifactFolders ||= {};
  connection.artifactIds ||= {};
  async function folder(path: string): Promise<string> {
    if (connection.artifactFolders![path])
      return connection.artifactFolders![path];
    const parts = path.split("/");
    const name = parts.pop()!;
    const parent = parts.length
      ? await folder(parts.join("/"))
      : connection.folderId;
    const result = await drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parent],
      },
      fields: "id",
    });
    const id = result.data.id!;
    connection.artifactFolders![path] = id;
    await onProgress();
    return id;
  }
  async function move(fileId: string, parent: string) {
    const current =
      (await metadata(shop, fileId)).parents || [];
    if (current.length !== 1 || current[0] !== parent)
      await drive.files.update({
        fileId,
        addParents: parent,
        removeParents:
          current.filter((p) => p !== parent).join(",") || undefined,
      });
  }
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split("/");
    const name = parts.pop()!;
    const parent = await folder(parts.join("/"));
    const mimeType = path.endsWith(".html")
      ? "text/html"
      : path.endsWith(".md")
        ? "text/markdown"
        : path.endsWith(".js")
          ? "text/javascript"
        : "application/json";
    const fileId = connection.artifactIds[path];
    if (fileId) {
      await move(fileId, parent);
      await drive.files.update({
        fileId,
        media: { mimeType, body: Readable.from([content]) },
      });
    } else {
      connection.artifactIds[path] = (
        await drive.files.create({
          requestBody: { name, parents: [parent] },
          media: { mimeType, body: Readable.from([content]) },
          fields: "id",
        })
      ).data.id!;
      await onProgress();
    }
  }
  if (draftId) { await onProgress(); return; }
  for (const [path, fileId] of Object.entries(connection.artifactIds))
    if (
      /^web\/(blogs|announcements)\/\d{4}-\d{2}-\d{2}-.+\.html$/.test(path) &&
      !(path in files)
    )
      await move(fileId, await folder("admin/posts/unpublished"));
  for (const [path, fileId] of Object.entries(connection.artifactIds))
    if (/^admin\/posts\/[^/]+\.md$/.test(path) && !(path in files))
      await move(fileId, await folder("admin/posts/deleted"));
  const doc = documents(config, shop.history);
  await Promise.all([
    drive.files.update({
      fileId: connection.specId,
      media: { mimeType: "text/markdown", body: Readable.from([doc.spec]) },
    }),
    drive.files.update({
      fileId: connection.historyId,
      media: { mimeType: "text/markdown", body: Readable.from([doc.history]) },
    }),
  ]);
  await onProgress();
}

  return { provision, syncConfig, syncShopDocuments, syncPostFiles, createFolder, readText, trashFile, customerFiles,
    read: bytes, remove,
    async removeShop(shop: Shop) {
      const entries = (await store.entries<Metadata>("shopFile")).filter(({ value }) => value.shopId === shop.id && !value.trashed);
      await forEachConcurrent(entries, 4, async ({ id, value }) => {
        await objects.remove(path(shop, value.id));
        await store.put("shopFile", id, { ...value, trashed: true });
      });
    },
    async importFile(shop: Shop, file: { id: string; name: string; mimeType: string; parents?: string[]; appProperties?: Record<string, string> }, content: Buffer) {
      await repository(shop).files.create({ requestBody: file, media: { mimeType: file.mimeType, body: Readable.from([content]) } });
    },
    async entries(shop: Shop) { return (await store.records<Metadata>("shopFile", shop)).filter(file => !file.trashed && file.mimeType !== "application/vnd.google-apps.folder"); },
    async write(shop: Shop, name: string, content: Buffer | string, mimeType: string, parent?: string) {
      return (await repository(shop).files.create({ requestBody: { name, ...(parent ? { parents: [parent] } : {}) }, media: { mimeType, body: Readable.from([content]) } })).data.id;
    },
  };
}
export type ShopStorage = ReturnType<typeof shopStorage>;

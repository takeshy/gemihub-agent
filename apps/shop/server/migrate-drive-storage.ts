import { tr } from "../shared/i18n.ts";
import { clients } from "./google.ts";
import { shopStorage, type ShopStorage } from "./shop-storage.ts";
import type { Shop, Store } from "./store.ts";

/** Explicit one-time migration. Source Drive data is never changed or deleted. */
export async function migrateDriveStorage(store: Store, shop: Shop, token: string, destination: ShopStorage = shopStorage(store)) {
  return store.locked(shop.id, async () => {
    const current = await store.shop(shop.id);
    if (!current) throw new Error(tr("お店がありません"));
    if (current.storage) return { ok: true, migrated: false };
    if (!current.google) throw new Error(tr("移行元のDrive保存先がありません"));
    const { drive } = clients(token);
    let count = 0;
    async function copy(id: string, parent?: string) {
      if (++count > 20000) throw new Error(tr("移行ファイル数の上限を超えました。個別に確認してください。"));
      const metadata = (await drive.files.get({ fileId: id, fields: "id,name,mimeType,appProperties,trashed" })).data;
      if (metadata.trashed) return;
      const folder = metadata.mimeType === "application/vnd.google-apps.folder";
      const bytes = folder ? Buffer.alloc(0) : Buffer.from((await drive.files.get({ fileId: id, alt: "media" }, { responseType: "arraybuffer" })).data as ArrayBuffer);
      await destination.importFile(current!, { id, name: metadata.name || id, mimeType: metadata.mimeType || "application/octet-stream", ...(parent ? { parents: [parent] } : {}), ...(metadata.appProperties ? { appProperties: metadata.appProperties } : {}) }, bytes);
      if (folder) {
        let pageToken: string | undefined;
        do {
          const result = await drive.files.list({ q: `'${id.replaceAll("'", "\\'")}' in parents and trashed = false`, fields: "nextPageToken,files(id)", pageSize: 1000, pageToken });
          for (const child of result.data.files || []) if (child.id) await copy(child.id, id);
          pageToken = result.data.nextPageToken || undefined;
        } while (pageToken);
      }
    }
    await copy(current.google.folderId);
    current.storage = { ...current.google, provider: "gcs" };
    await store.saveShop(current);
    return { ok: true, migrated: true, files: count };
  });
}

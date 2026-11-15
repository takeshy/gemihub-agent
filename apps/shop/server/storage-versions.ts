import { readFile } from "node:fs/promises";
import { artifacts } from "./artifacts.ts";
import { designOf, isDesignArtifact, validateSnapshot, type DesignSnapshot, type DesignVersionStorage } from "./design-versions.ts";
import type { Shop } from "./store.ts";
import type { ShopStorage } from "./shop-storage.ts";

/** Snapshots and all their contents are private and bound to a single shop. */
export function storageDesignVersions(shop: Shop, files: ShopStorage): DesignVersionStorage {
  return {
    ready: value => !!value.published && (!Object.keys(value.storage?.artifactIds || {}).length || ["web/index.html", "web/data.js", "web/shop.json", "web/mock.json"].every(path => value.storage?.artifactIds?.[path])),
    async capture(value, publication) {
      if (!value.published) return null;
      const current: Record<string, string> = {};
      const ids = Object.entries(value.storage?.artifactIds || {}).filter(([path]) => isDesignArtifact(path));
      if (ids.length) for (const [path, id] of ids) current[path] = await files.readText(value, id);
      else Object.assign(current, Object.fromEntries(Object.entries(artifacts(value.published, await readFile("dist/index.html", "utf8"))).filter(([path]) => isDesignArtifact(path))));
      const snapshot = validateSnapshot({ design: designOf(value.published), files: current });
      const id = await files.write(value, `design-version-${publication.number}.json`, JSON.stringify({ schemaVersion: 2, ...snapshot }), "application/json", value.storage?.folderId);
      return { folderId: id, manifestId: id };
    },
    async readDesign(version) { return (await read(version.manifestId)).design; },
    async read(version) { return read(version.manifestId); },
    trash: version => files.remove(shop, version.manifestId),
  };
  async function read(id: string) {
    const value = JSON.parse(await files.readText(shop, id)) as DesignSnapshot & { schemaVersion?: number };
    if (value.schemaVersion !== 2) {
      // Migrated Drive archives contain file IDs. Resolve them from Cloud Storage only.
      const resolved: Record<string, string> = {};
      for (const [path, fileId] of Object.entries(value.files)) resolved[path] = await files.readText(shop, fileId);
      value.files = resolved;
    }
    return validateSnapshot(value);
  }
}

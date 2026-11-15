import { Store } from "../server/store.ts";
import { migrateDriveStorage } from "../server/migrate-drive-storage.ts";

const id = process.argv[2];
if (!id || process.argv.length !== 3) throw new Error("Usage: npm run migrate:storage --workspace @gemihub/shop -- <shop-id>");
const store = new Store();
try {
  const shop = await store.shop(id);
  if (!shop) throw new Error("お店がありません");
  const token = await store.ownerToken(shop);
  if (!token) throw new Error("移行元のDriveを読める、既存のGoogle接続が必要です。");
  const result = await migrateDriveStorage(store, shop, token);
  console.log(JSON.stringify(result));
} finally { await store.close(); }

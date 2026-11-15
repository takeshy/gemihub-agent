import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateShops } from "./shops.mjs";

const root = new URL("../", import.meta.url);
const origin = process.argv[2] || "http://localhost:8090";
const shops = validateShops(JSON.parse(await readFile(new URL("site/shops.json", root), "utf8")));
for (const shop of shops) {
  if (!shop.networkUrl) { console.log(`${shop.name}: 店舗紹介のみ（エージェント未設定）`); continue; }
  console.log(`\n${shop.name}: ${shop.networkUrl}`);
  const run = spawnSync(process.execPath, ["vendor/agentify-website/scripts/check_partner.mjs", shop.networkUrl, "--origin", origin], { cwd: fileURLToPath(root), stdio: "inherit", timeout: 30000 });
  if (run.error || run.status !== 0) process.exitCode = 1;
}

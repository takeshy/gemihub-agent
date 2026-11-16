import { cp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { buildSite } from "../../scripts/build.mjs";
import { applyPublishedDesign } from "../../admin/site-design.mjs";

export async function initializeParent({ root = process.env.PARENT_ROOT, codeRoot = fileURLToPath(new URL("../../", import.meta.url)) } = {}) {
  if (!root || resolve(root) === resolve(codeRoot)) throw new Error("PARENT_ROOT must point to the persistent parent volume");
  await mkdir(join(root, "site"), { recursive: true });
  try { await readFile(join(root, "site/shops.json")); }
  catch (error) { if (error.code !== "ENOENT") throw error; await writeFile(join(root, "site/shops.json"), JSON.stringify({ version: 1, shops: [] }) + "\n", { flag: "wx" }); }
  // Refresh static assets on each release, preserving the operator-managed registry.
  const registry = join(codeRoot, "site/shops.json");
  const documents = join(codeRoot, "site/chat-documents.json");
  const documentFiles = join(codeRoot, "site/chat-document-files");
  await cp(join(codeRoot, "site"), join(root, "site"), { recursive: true, filter: source => source !== registry && source !== documents && source !== documentFiles });
  for (const name of ["src", "vendor"]) {
    try { await symlink(join(codeRoot, name), join(root, name), process.platform === "win32" ? "junction" : "dir"); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  await buildSite({ root: pathToFileURL(root + "/"), production: true, stdio: "pipe" });
  await applyPublishedDesign({ root, sourceRoot: codeRoot });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await initializeParent();

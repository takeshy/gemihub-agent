import { build } from "vite";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

await build({ configFile: fileURLToPath(new URL("../admin/editor/vite.config.mjs", import.meta.url)) });

const root = fileURLToPath(new URL("../", import.meta.url));
const shop = fileURLToPath(new URL("../apps/shop/", import.meta.url));
const port = (key, fallback) => {
  const value = Number(process.env[key] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${key} must be a port from 1 to 65535`);
  return String(value);
};
const finderPort = port("FINDER_PORT", 8090);
const adminPort = port("ADMIN_PORT", 8091);
const shopPort = port("SHOP_PORT", 3000);
if (new Set([finderPort, adminPort, shopPort]).size !== 3) throw new Error("The three services need different ports");

console.log(`お店さがし: http://localhost:${finderPort}/`);
console.log(`店舗管理: http://127.0.0.1:${adminPort}/`);
console.log(`店舗デモ: http://127.0.0.1:${shopPort}/ (メモリ内のデータ)`);

const children = new Set();
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  const timer = setTimeout(() => { for (const child of children) child.kill("SIGKILL"); }, 5000);
  timer.unref();
}
function start(name, args, cwd, env = {}) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit" });
  children.add(child);
  child.on("error", error => { console.error(`${name}: ${error.message}`); stop(1); });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) { console.error(`${name} stopped (${signal || code})`); stop(code || 1); }
  });
}
process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));
start("finder", ["--env-file-if-exists=.env", "--import", "tsx", "scripts/serve.mjs", "--port", finderPort], root);
start("admin", ["--env-file-if-exists=.env", "admin/server.mjs"], root, { ADMIN_PORT: adminPort, SHOP_ADMIN_ORIGIN: `http://127.0.0.1:${shopPort}` });
start("shop", ["--env-file-if-exists=.env", "--import", "tsx", "server/index.ts"], shop, {
  DEMO_MODE: "true", SEED: "restaurant-demo", PORT: shopPort,
  APP_ORIGIN: `http://127.0.0.1:${shopPort}`, AGENT_PARENT_URL: `http://localhost:${finderPort}`,
  PARENT_MAIL_URL: process.env.PARENT_MAIL_URL || `http://127.0.0.1:${adminPort}/api/internal/mail`,
});

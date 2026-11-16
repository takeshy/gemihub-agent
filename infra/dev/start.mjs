import { spawn } from "node:child_process";

const children = new Set();
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
  const deadline = setTimeout(() => { for (const child of children) child.kill("SIGKILL"); }, 80000);
  deadline.unref();
}
function start(args, cwd) {
  const child = spawn(process.execPath, args, { cwd, env: process.env, stdio: "inherit" });
  children.add(child);
  child.on("error", error => { console.error(error.message); stop(1); });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (!stopping) { console.error(`Service stopped: ${signal || code}`); stop(code || 1); }
  });
}
process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));
start(["--max-old-space-size=48", "vendor/agentify-website/scripts/serve_site.mjs", `${process.env.PARENT_ROOT}/site`, "--host", "0.0.0.0", "--port", "8090"], "/app");
start(["--max-old-space-size=192", "admin/server.mjs", "--production"], "/app");
start(["--max-old-space-size=512", "--import", "tsx", "server/index.ts"], "/app/apps/shop");

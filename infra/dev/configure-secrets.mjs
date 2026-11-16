import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

const project = process.argv[2], operator = process.argv[3];
if (!/^[a-z][a-z0-9-]+$/.test(project || "") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(operator || "")) throw new Error("Usage: node infra/dev/configure-secrets.mjs <project> <operator-email>");
function gcloud(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("gcloud", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", bytes => { out += bytes; });
    child.stderr.resume();
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve(out) : reject(new Error(`gcloud ${args.slice(0, 3).join(" ")} failed; secret values are not logged`)));
    child.stdin.on("error", () => {}); child.stdin.end(input);
  });
}
const base = ["--project", project], name = "gemihub-dev-runtime";
const versions = await gcloud(["secrets", "versions", "list", name, ...base, "--format=value(name)", "--limit=1"]);
const data = versions.trim() ? JSON.parse(await gcloud(["secrets", "versions", "access", "latest", "--secret", name, ...base])) : {};
if (process.argv[4]) {
  const client = JSON.parse(await readFile(process.argv[4], "utf8")).web;
  const redirects = ["https://admin.dev.gemihub.net/auth/google/callback", "https://shop.dev.gemihub.net/auth/google/callback"];
  if (!client?.client_id || !client.client_secret || client.project_id !== project || redirects.some(uri => !client.redirect_uris?.includes(uri))) throw new Error("The OAuth JSON must belong to this project and include both dev callback URIs");
  data.GOOGLE_CLIENT_ID = client.client_id; data.GOOGLE_CLIENT_SECRET = client.client_secret;
}
for (const key of ["SESSION_SECRET", "PARENT_AUTH_SECRET", "PARENT_INTEGRATION_SECRET", "ACCESS_PASSWORD"]) {
  if (!data[key]) data[key] = randomBytes(32).toString("hex");
}
// Opt-in shared login link for demos; DEMO_LOGIN=off removes it and DEMO_LOGIN=on creates it once.
if (process.env.DEMO_LOGIN === "off") delete data.PARENT_DEMO_LOGIN_TOKEN;
else if (process.env.DEMO_LOGIN === "on" && !data.PARENT_DEMO_LOGIN_TOKEN) data.PARENT_DEMO_LOGIN_TOKEN = randomBytes(32).toString("hex");
const local = parseEnv(await readFile(new URL("../../.env", import.meta.url), "utf8"));
if (local.GEMINI_API_KEY) data.GEMINI_API_KEY = local.GEMINI_API_KEY;
data.PARENT_ADMIN_EMAILS = operator; data.ADMIN_EMAILS = operator;
await gcloud(["secrets", "versions", "add", name, ...base, "--data-file=-"], JSON.stringify(data) + "\n");
console.log("Saved dev runtime settings. Existing encryption keys were preserved; secret values were not printed.");

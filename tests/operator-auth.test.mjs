import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get, request } from "node:http";
import { createGoogleAuth } from "../admin/google-auth.mjs";
import { createAdminServer } from "../admin/server.mjs";

test("parent operators require allowed Google accounts; Gmail grants are encrypted and never appear in browser sessions", async t => {
  const root = await mkdtemp(join(tmpdir(), "parent-google-auth-"));
  const secret = "integration-secret-".repeat(3), sent = [], invitations = [];
  let email = "admin@example.com", granted = "openid email profile https://www.googleapis.com/auth/gmail.send";
  const auth = createGoogleAuth({ root, env: { GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: "fixture-secret", PARENT_ADMIN_EMAILS: email, PARENT_AUTH_SECRET: "encryption-key-".repeat(3), PARENT_DEMO_LOGIN_TOKEN: "demo-token-".repeat(4) }, oauthFactory: redirect => ({
    generateAuthUrl(args) { const url = new URL("https://accounts.google.com/authorize"); for (const [key, value] of Object.entries(args)) url.searchParams.set(key, Array.isArray(value) ? value.join(" ") : value); url.searchParams.set("redirect_uri", redirect); return url.href; },
    async getToken() { return { tokens: { id_token: "fixture-identity", refresh_token: "private-refresh-token", scope: granted } }; },
    async verifyIdToken() { return { getPayload: () => ({ email_verified: true, email }) }; },
    setCredentials(value) { assert.equal(value.refresh_token, "private-refresh-token"); },
  }), send: async (_client, message) => { sent.push(message); } });
  const server = createAdminServer({ root, auth, integrationSecret: secret, store: { get: async () => ({ shops: [] }) }, fetch: async (url, options) => {
    invitations.push({ url: String(url), ...options }); return Response.json({ ok: true });
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const post = (path, input, cookie = "", extra = {}) => fetch(origin + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, Cookie: cookie, ...extra }, body: JSON.stringify(input) });
  // Node fetch rewrites Sec-Fetch-Mode; send navigation headers through HTTP directly.
  const navigation = path => new Promise((resolve, reject) => {
    get(origin + path, { headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document" } }, response => {
      response.resume(); resolve(response.statusCode);
    }).on("error", reject);
  });
  assert.equal((await fetch(origin + "/api/shops")).status, 401);
  assert.equal(await navigation("/"), 200);
  assert.equal(await navigation("/api/shops"), 403);
  assert.equal((await post("/api/invitations", { email: "owner@example.com" })).status, 401);
  assert.equal((await post("/api/internal/mail", { to: "owner@example.com", subject: "s", text: "t" })).status, 403);
  const begin = async () => {
    const response = await fetch(origin + "/auth/google", { redirect: "manual" });
    const url = new URL(response.headers.get("location"));
    assert.ok(url.searchParams.get("scope").includes("gmail.send")); assert.ok(!url.searchParams.get("scope").includes("drive")); assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    return { url: `${origin}/auth/google/callback?state=${url.searchParams.get("state")}&code=valid`, cookie: response.headers.get("set-cookie").split(";")[0] };
  };
  const demoUrl = `${origin}/auth/demo?token=${"demo-token-".repeat(4)}`;
  assert.equal((await fetch(demoUrl, { redirect: "manual" })).status, 503);
  const start = await begin();
  assert.equal((await fetch(start.url, { redirect: "manual" })).status, 400);
  email = "outsider@example.com";
  const outsider = await begin();
  assert.equal((await fetch(outsider.url, { headers: { Cookie: outsider.cookie }, redirect: "manual" })).status, 403);
  email = "admin@example.com"; granted = "openid email profile";
  const noMail = await begin();
  assert.equal((await fetch(noMail.url, { headers: { Cookie: noMail.cookie }, redirect: "manual" })).status, 403);
  granted += " https://www.googleapis.com/auth/gmail.send";
  const valid = await begin();
  const done = await fetch(valid.url, { headers: { Cookie: valid.cookie, "Sec-Fetch-Site": "cross-site" }, redirect: "manual" });
  assert.equal(done.status, 302);
  const session = done.headers.getSetCookie().find(value => value.startsWith("finder_operator=")).split(";")[0];
  const status = await (await fetch(origin + "/api/session", { headers: { Cookie: session } })).json();
  assert.deepEqual(status, { user: { email }, configured: true });
  const disk = await readFile(join(root, "admin/auth.json"), "utf8");
  assert.equal((await fetch(`${origin}/auth/demo?token=wrong`, { redirect: "manual" })).status, 404);
  assert.equal((await fetch(`${origin}/auth/demo`, { redirect: "manual" })).status, 404);
  const demo = await fetch(demoUrl, { headers: { "Sec-Fetch-Site": "cross-site" }, redirect: "manual" });
  assert.equal(demo.status, 302);
  const demoSession = demo.headers.getSetCookie().find(value => value.startsWith("finder_operator=")).split(";")[0];
  assert.deepEqual(await (await fetch(origin + "/api/session", { headers: { Cookie: demoSession } })).json(), { user: { email }, configured: true });
  assert.ok(!disk.includes("private-refresh-token")); assert.ok(!disk.includes(session.split("=")[1]));
  assert.equal((await fetch(origin + "/auth.json", { headers: { Cookie: session } })).status, 404);
  assert.equal((await fetch(valid.url, { headers: { Cookie: valid.cookie }, redirect: "manual" })).status, 400);
  assert.equal((await post("/api/invitations", { email: "owner@example.com", name: "招待店", industry: "other" }, session)).status, 200);
  assert.equal(invitations[0].headers.Authorization, `Bearer ${secret}`);
  assert.equal(invitations[0].headers.Origin, "http://127.0.0.1:3000");
  assert.equal((await post("/api/internal/mail", { to: "owner@example.com", subject: "招待", text: "本文" }, "", { Authorization: `Bearer ${secret}` })).status, 200);
  assert.equal(sent.length, 1);
  assert.match(Buffer.from(sent[0].requestBody.raw, "base64url").toString(), /To: owner@example.com/);
  assert.equal((await post("/api/internal/mail", { to: "owner@example.com\r\nBcc: bad@example.com", subject: "s", text: "t" }, "", { Authorization: `Bearer ${secret}` })).status, 400);
  await post("/api/logout", {}, session);
  assert.equal((await fetch(origin + "/api/shops", { headers: { Cookie: session } })).status, 401);
});

test("parent administration stays closed when Google or the operator allowlist is not configured", async t => {
  const root = await mkdtemp(join(tmpdir(), "parent-auth-closed-"));
  const auth = createGoogleAuth({ root, env: {} });
  const server = createAdminServer({ root, auth });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin + "/")).status, 200);
  assert.equal((await fetch(origin + "/api/session")).status, 200);
  assert.equal((await fetch(origin + "/api/shops")).status, 401);
  assert.equal((await fetch(origin + "/auth/google", { redirect: "manual" })).status, 503);
  assert.equal((await fetch(origin + "/auth/demo?token=", { redirect: "manual" })).status, 404);
});

test("HTTPS administration pins its host and origin while private Gmail relay requires its server secret", async t => {
  const root = await mkdtemp(join(tmpdir(), "parent-public-auth-"));
  const publicOrigin = "https://admin.dev.example", secret = "private-server-secret-".repeat(3);
  const auth = createGoogleAuth({ root, env: { GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: "fixture-secret", PARENT_ADMIN_EMAILS: "admin@example.com", PARENT_AUTH_SECRET: "encryption-key-".repeat(3), PARENT_ORIGIN: publicOrigin }, oauthFactory: redirect => ({
    generateAuthUrl() { return `https://accounts.google.com/authorize?redirect_uri=${encodeURIComponent(redirect)}`; },
  }) });
  let mails = 0;
  auth.mail = async () => { mails++; };
  const server = createAdminServer({ root, publicOrigin, auth, integrationSecret: secret });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  const call = (path, { method = "GET", headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: server.address().port, path, method, headers: { Host: "admin.dev.example", ...headers } }, response => {
      response.resume(); response.on("end", () => resolve({ status: response.statusCode, headers: response.headers }));
    });
    req.on("error", reject); req.end(body);
  });
  assert.equal((await call("/")).status, 200);
  assert.equal((await call("/api/shops")).status, 401);
  assert.equal((await call("/api/session", { headers: { Host: "spoof.example" } })).status, 403);
  assert.equal((await call("/api/logout", { method: "POST", headers: { Origin: "http://admin.dev.example" } })).status, 403);
  const begin = await call("/auth/google");
  assert.equal(begin.status, 302);
  assert.equal(new URL(begin.headers.location).searchParams.get("redirect_uri"), `${publicOrigin}/auth/google/callback`);
  assert.match(begin.headers["set-cookie"][0], /; Secure/);
  const mail = { method: "POST", headers: { Host: "admin:8091", "Content-Type": "application/json" }, body: JSON.stringify({ to: "owner@example.com" }) };
  assert.equal((await call("/api/internal/mail", mail)).status, 403);
  assert.equal((await call("/api/internal/mail", { ...mail, headers: { ...mail.headers, Authorization: `Bearer ${secret}` } })).status, 200);
  assert.equal(mails, 1);
  assert.throws(() => createAdminServer({ root, publicOrigin: "http://admin.dev.example" }), /HTTPS/);
});

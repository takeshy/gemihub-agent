import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get } from "node:http";
import { createGoogleAuth } from "../admin/google-auth.mjs";
import { createAdminServer } from "../admin/server.mjs";

test("parent operators require allowed Google accounts; Gmail grants are encrypted and never appear in browser sessions", async t => {
  const root = await mkdtemp(join(tmpdir(), "parent-google-auth-"));
  const secret = "integration-secret-".repeat(3), sent = [], invitations = [];
  let email = "admin@example.com", granted = "openid email profile https://www.googleapis.com/auth/gmail.send";
  const auth = createGoogleAuth({ root, env: { GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: "fixture-secret", PARENT_ADMIN_EMAILS: email, PARENT_AUTH_SECRET: "encryption-key-".repeat(3) }, oauthFactory: redirect => ({
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
});

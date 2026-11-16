import test from "node:test";
import assert from "node:assert/strict";
import { vertexStatus, providerReady, requireText } from "../server/llm.ts";

test("Google AI can use the service Gemini key without ADC project settings, while status never returns credentials", async t => {
  const names = ["GOOGLE_CLOUD_PROJECT", "GEMINI_API_KEY", "GEMINI_MODEL", "VERTEX_MODEL", "GOOGLE_AI_AUTH"];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => { for (const name of names) { if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name]; } });
  for (const name of names) delete process.env[name];
  process.env.GEMINI_API_KEY = "service-key-not-for-browser";
  assert.equal(providerReady("vertex"), true); assert.equal(vertexStatus().model, "gemini-4-hydrogen");
  assert.equal(vertexStatus().apiKey, true); assert.ok(!JSON.stringify(vertexStatus()).includes(process.env.GEMINI_API_KEY));
  assert.equal(await requireText("not configured"), "vertex");
  process.env.GOOGLE_AI_AUTH = "vertex";
  assert.equal(providerReady("vertex"), false);
  await assert.rejects(requireText("not configured"), /not configured/);
  process.env.GOOGLE_CLOUD_PROJECT = "configured-project"; process.env.VERTEX_MODEL = "configured-model";
  assert.equal(providerReady("vertex"), true); assert.equal(vertexStatus().apiKey, false);
});

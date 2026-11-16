import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runVisibleChatTurn } from "../site/voice-turn.js";

// A minimal chat UI: the observer callback is driven by hand to end the turn.
function chat({ onConsent, onActionConfirm = async () => true } = {}) {
  let observe;
  globalThis.MutationObserver = class { constructor(callback) { observe = callback; } observe() {} disconnect() {} };
  const bar = { dataset: { turnActive: "false" } }, messages = [];
  const input = { value: "", dispatchEvent() {} };
  const engine = { onConsent, onActionConfirm };
  const doc = {
    defaultView: { __nsweb: { engine } },
    getElementById: id => ({ "ns-input": input, "ns-send": { disabled: false, click() {} }, "agent-app": {} })[id],
    querySelector: () => bar,
    querySelectorAll: () => messages,
  };
  const begin = () => { bar.dataset.turnActive = "true"; observe(); };
  const end = text => {
    begin();
    messages.push({ textContent: text, matches: () => false });
    bar.dataset.turnActive = "false"; observe();
  };
  return { doc, engine, end, begin };
}

test("voice turns keep consent decisions, and a cancelled turn declines instead of allowing", async () => {
  for (const decision of ["allow", "always", "decline"]) {
    const { doc, engine, end } = chat({ onConsent: async () => decision });
    const turn = runVisibleChatTurn(doc, "近くのお店は？");
    assert.equal(await engine.onConsent({ peerOrigin: "https://shop.example" }), decision);
    end("回答"); assert.equal(await turn, "回答");
    assert.equal(await engine.onConsent(), decision, "the page's own hook is restored");
  }
  // Audio stops after the turn began: the guards stay until the turn ends, and they must refuse.
  const controller = new AbortController();
  const { doc, engine, end, begin } = chat({ onConsent: async () => "allow", onActionConfirm: async () => true });
  const turn = runVisibleChatTurn(doc, "予約できますか", controller.signal);
  begin(); controller.abort();
  assert.equal(await engine.onConsent({ peerOrigin: "https://shop.example" }), "decline");
  assert.equal(await engine.onActionConfirm([]), false);
  end("回答"); await assert.rejects(turn, /中止/);
});

test("voice turns on pages without a consent hook keep the engine's allow default", async () => {
  const { doc, engine, end } = chat({ onConsent: null });
  const turn = runVisibleChatTurn(doc, "近くのお店は？");
  assert.equal(await engine.onConsent({ peerOrigin: "https://shop.example" }), "allow");
  end("回答"); await turn;
  assert.equal(engine.onConsent, null);
});

test("the shop app ships the same voice turn module as the finder", async () => {
  // The shop image contains only apps/shop, so it carries its own copy.
  assert.equal(await readFile(new URL("../apps/shop/agentic/site/voice-turn.js", import.meta.url), "utf8"), await readFile(new URL("../site/voice-turn.js", import.meta.url), "utf8"));
});

test("the finder's microphone worklet is the shop's worklet", async () => {
  // The finder is served from its own origin, so it keeps a copy of the shop's processor.
  assert.equal(await readFile(new URL("../site/voice-audio.js", import.meta.url), "utf8"), await readFile(new URL("../apps/shop/public/live-audio.js", import.meta.url), "utf8"));
});

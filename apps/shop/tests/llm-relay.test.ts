import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
// @ts-expect-error Plain JavaScript shipped to the restaurant page.
import { RelayClient } from "../agentic/site/llm-relay.js";

const parentOrigin = "https://finder.example";
const scriptURL = "https://shop.example/s/akari/agent/llm-relay-sw.js";

function client() {
  const workers = Object.assign(new EventTarget(), {
    controller: { scriptURL },
    register: async (_url: string, _options: unknown) => ({}),
  });
  const sent: { message: any; origin: string }[] = [];
  const parent = { postMessage: (message: any, origin: string) => sent.push({ message, origin }) };
  const window = Object.assign(new EventTarget(), {
    navigator: { serviceWorker: workers }, location: { origin: "https://shop.example" }, parent,
  });
  const relay = new RelayClient({ parentOrigin, shop: "akari", base: "/s/akari", window });
  const fromParent = (data: unknown, origin = parentOrigin, source: unknown = parent) => relay.fromParent({ data, origin, source });
  const port = () => ({ sent: [] as any[], closed: false, postMessage(data: any) { this.sent.push(data); }, close() { this.closed = true; }, onmessage: null as any });
  return { relay, workers, window, parent, sent, fromParent, port };
}

test("a shop accepts only its parent's window, current session and controlling service worker", async () => {
  const c = client();
  const opened = c.relay.connect();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(c.sent, [{ message: { type: "gemihub:relay-hello", version: 1, shop: "akari" }, origin: parentOrigin }]);
  const welcome = { type: "gemihub:relay-open", session: "allowed", model: "chosen-model" };
  c.fromParent(welcome, "https://other.example");
  c.fromParent(welcome, parentOrigin, {});
  assert.equal(c.relay.session, null);
  c.fromParent(welcome);
  assert.deepEqual(await opened, { router: "https://shop.example/s/akari/agent/llm-bridge/v1", key: "relay-allowed", model: "chosen-model" });
  const port = c.port();
  const data = { type: "gemihub:llm-request", path: "chat/completions", body: "{}" };
  c.relay.fromWorker({ source: {}, data, ports: [port] });
  assert.equal(c.relay.pending.size, 0);
  c.relay.fromWorker({ source: c.workers.controller, data, ports: [port] });
  const request: any = c.sent.at(-1)!.message;
  assert.equal(request.id, "allowed:1");
  c.fromParent({ type: "gemihub:llm-chunk", session: "old", id: request.id, text: "ignored" });
  assert.equal(port.sent.length, 0);
  c.fromParent({ type: "gemihub:llm-head", session: "allowed", id: request.id, status: 200, contentType: "text/event-stream" });
  c.fromParent({ type: "gemihub:llm-chunk", session: "allowed", id: request.id, text: "data: 回答\n\n" });
  c.fromParent({ type: "gemihub:llm-end", session: "allowed", id: request.id });
  assert.deepEqual(port.sent.map(message => message.type), ["head", "chunk", "end"]);
  assert.equal(port.closed, true);
  assert.equal(c.relay.pending.size, 0);
});

test("stopping or leaving a shop aborts pending requests and refuses reuse", async () => {
  const c = client();
  const opened = c.relay.connect();
  await new Promise(resolve => setImmediate(resolve));
  c.fromParent({ type: "gemihub:relay-open", session: "allowed", model: "chosen-model" });
  await opened;
  const port = c.port();
  const request = { source: c.workers.controller, data: { type: "gemihub:llm-request", path: "chat/completions", body: "{}" }, ports: [port] };
  c.relay.fromWorker(request);
  c.fromParent({ type: "gemihub:relay-closed", session: "old" });
  assert.equal(c.relay.session, "allowed");
  c.window.dispatchEvent(new Event("pagehide"));
  assert.equal(c.relay.session, null);
  assert.deepEqual(c.sent.at(-1)!.message, { type: "gemihub:llm-abort", session: "allowed", id: "allowed:1" });
  assert.equal(port.sent[0].status, 503);
  assert.equal(port.closed, true);
  const refused = c.port();
  c.relay.fromWorker({ ...request, ports: [refused] });
  assert.equal(refused.sent[0].status, 503);
  assert.equal(c.relay.pending.size, 0);
});

test("registration must control the page with the relay worker rather than an unrelated worker", async () => {
  const c = client();
  c.workers.controller = { scriptURL: "https://shop.example/other-worker.js" };
  let ready = false;
  const controlled = c.relay.controlled(c.workers, scriptURL).then(() => { ready = true; });
  c.workers.dispatchEvent(new Event("controllerchange"));
  await Promise.resolve();
  assert.equal(ready, false);
  c.workers.controller = { scriptURL };
  c.workers.dispatchEvent(new Event("controllerchange"));
  await controlled;
  assert.equal(ready, true);
});

/** Execute the shipped worker with real Request/Response/MessageChannel primitives. */
async function worker(t: { after(fn: () => void): void }) {
  const listeners = new Map<string, (event: any) => void>();
  const timers = new Map<number, () => void>();
  const ports: MessagePort[] = [];
  let sequence = 0;
  let answer: (port: MessagePort) => void = () => {};
  let currentPort: MessagePort | undefined;
  const self = {
    registration: { scope: "https://shop.example/s/akari/" },
    addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler),
    clients: { get: async () => ({ postMessage(_data: unknown, transfers: MessagePort[]) {
      currentPort = transfers[0];
      ports.push(currentPort);
      answer(currentPort);
    } }) },
  };
  runInNewContext(await readFile(new URL("../agentic/site/llm-relay-sw.js", import.meta.url), "utf8"), {
    self, URL, Response, ReadableStream, TextEncoder, MessageChannel,
    setTimeout: (fn: () => void) => { timers.set(++sequence, fn); return sequence; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  t.after(() => { for (const port of ports) port.close(); });
  function fetch(path = "chat/completions", options: RequestInit = { method: "POST", body: "{}" }, clientId = "page") {
    let response: Promise<Response> | undefined;
    let lifetime: Promise<void> | undefined;
    listeners.get("fetch")!({
      request: new Request(`https://shop.example/s/akari/agent/llm-bridge/v1/${path}`, options), clientId,
      respondWith: (value: Promise<Response>) => { response = value; },
      waitUntil: (value: Promise<void>) => { lifetime = value; },
    });
    return { response: response!, lifetime: () => lifetime! };
  }
  return { fetch, timers, respond: (fn: typeof answer) => { answer = fn; }, port: () => currentPort! };
}

test("the worker streams text and tool-call fragments unchanged, and ends its lifetime", async t => {
  const w = await worker(t);
  const chunks = ['data: {"choices":[{"delta":{"content":"回答"}}]}\n\n', 'data: {"choices":[{"delta":{"tool_calls":[{"index":0}]}}]}\n\n', "data: [DONE]\n\n"];
  w.respond(port => {
    port.postMessage({ type: "head", status: 200, contentType: "text/event-stream" });
    for (const text of chunks) port.postMessage({ type: "chunk", text });
    port.postMessage({ type: "end" });
  });
  const request = w.fetch();
  const response = await request.response;
  assert.equal(response.status, 200);
  assert.equal(await response.text(), chunks.join(""));
  await request.lifetime();
  assert.equal(w.timers.size, 0);
  for (const [path, method] of [["models", "DELETE"], ["chat/completions", "GET"], ["other", "GET"]]) {
    assert.equal((await w.fetch(path, { method }).response).status, 404);
  }
  assert.equal((await w.fetch("models", { method: "GET" }, "").response).status, 503);
});

test("a parent that disappears after headers cannot leave a stream hanging", async t => {
  const w = await worker(t);
  w.respond(port => port.postMessage({ type: "head", status: 200 }));
  const request = w.fetch();
  const response = await request.response;
  const reading = response.text();
  const rejected = assert.rejects(reading, /did not answer in time/);
  for (const expire of w.timers.values()) expire();
  await rejected;
  await request.lifetime();
  assert.equal(w.timers.size, 0);
});

test("cancelling before headers completes the worker instead of waiting for the timeout", async t => {
  const w = await worker(t);
  const controller = new AbortController();
  const request = w.fetch("chat/completions", { method: "POST", body: "{}", signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  assert.equal((await request.response).status, 499);
  await request.lifetime();
  assert.equal(w.timers.size, 0);
});

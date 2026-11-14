// Relays a framed shop page's model requests to the visitor's own LLM provider.
// The shop's assistant runs inside the shop's page; this site holds the visitor's key and
// makes the call. The key goes only to the router the visitor chose here: never to the
// shop, and never to an address the shop names. What the shop sends is untrusted input.

export const RELAY_LIMITS = {
  maxRequests: 40,
  maxMinutes: 30,
  maxBodyBytes: 512 * 1024,
  requestTimeoutMs: 120000,
};
const hostOf = url => { try { return new URL(url).host; } catch { return ""; } };

export class LlmRelay {
  /**
   * :param getSetup: Returns the visitor's applied setup: {router, key, model}.
   * :param fetchImpl: fetch, or a stand-in for tests.
   * :param now: The clock, in milliseconds.
   * :param onChange: Called when the session or its use changes, to redraw its status.
   */
  constructor({ getSetup, fetchImpl = (...args) => globalThis.fetch(...args), now = () => Date.now(), limits = RELAY_LIMITS, onChange = () => {}, newId = () => globalThis.crypto.randomUUID() }) {
    this.getSetup = getSetup;
    this.fetch = fetchImpl;
    this.now = now;
    this.limits = limits;
    this.onChange = onChange;
    this.newId = newId;
    this.session = null;
    this.running = new Map();
  }

  /** Whether the visitor has a usable setup to relay with. */
  ready() {
    const setup = this.getSetup();
    return !!(setup?.key && setup.key !== "demo" && setup.router && setup.model);
  }

  /** Start a session for one shop the visitor just allowed. Any earlier session ends. */
  open(shop) {
    this.close();
    this.session = { id: this.newId(), shopId: shop.id, origin: new URL(shop.pageUrl).origin, startedAt: this.now(), requests: 0 };
    this.onChange();
    return this.session;
  }

  /** End the session: what is in flight is stopped, and nothing more is accepted for it. */
  close() {
    for (const controller of this.running.values()) controller.abort();
    this.running.clear();
    const closed = this.session;
    this.session = null;
    if (closed) this.onChange();
    return closed;
  }

  status() {
    const session = this.session;
    if (!session) return null;
    const minutesLeft = Math.max(0, Math.ceil(this.limits.maxMinutes - (this.now() - session.startedAt) / 60000));
    return { shopId: session.shopId, requests: session.requests, maxRequests: this.limits.maxRequests, minutesLeft };
  }

  abort(id) {
    this.running.get(id)?.abort();
  }

  /**
   * Answer one request from the framed shop page.
   *
   * :param message: {session, id, path, body} as the shop page sent it.
   * :param send: send(type, fields) passes "head", "chunk", "end" or "error" back to that page.
   */
  async handle(message, send) {
    const refuse = (status, text) => send("error", { status, message: text });
    const session = this.session;
    if (!session || message?.session !== session.id || typeof message.id !== "string" || !message.id.startsWith(`${session.id}:`)) {
      return refuse(403, "The AI relay is not open for this page.");
    }
    if (this.now() - session.startedAt > this.limits.maxMinutes * 60000) {
      return refuse(429, `The AI relay's time limit (${this.limits.maxMinutes} minutes) has passed. Open the shop again on the finder site.`);
    }
    const setup = this.getSetup();
    if (!this.ready()) return refuse(503, "No AI setup is applied on the finder site.");
    if (message.path === "models") {
      // The model is the one chosen here; the shop is told its name and nothing about the provider.
      send("head", { status: 200, contentType: "application/json" });
      send("chunk", { text: JSON.stringify({ object: "list", data: [{ id: setup.model, object: "model" }] }) });
      return send("end", {});
    }
    if (message.path !== "chat/completions") return refuse(404, "The AI relay passes on chat completions only.");
    if (typeof message.body !== "string" || new TextEncoder().encode(message.body).byteLength > this.limits.maxBodyBytes) return refuse(413, "The request is too large for the AI relay.");
    let asked;
    try { asked = JSON.parse(message.body); } catch { return refuse(400, "The request is not valid JSON."); }
    if (!asked || typeof asked !== "object" || !Array.isArray(asked.messages) || !asked.messages.length) return refuse(400, "The request has no messages.");
    if (session.requests >= this.limits.maxRequests) {
      return refuse(429, `The AI relay's limit of ${this.limits.maxRequests} requests has been reached. Open the shop again on the finder site.`);
    }
    if (this.running.has(message.id)) return refuse(409, "This AI relay request is already running.");
    session.requests += 1;
    this.onChange();
    // Only what a chat turn needs is passed on. The model and the destination are the visitor's
    // choices here; whatever else the shop put in the request is dropped.
    const body = { model: setup.model, messages: asked.messages, stream: true, ...(Array.isArray(asked.tools) && asked.tools.length ? { tools: asked.tools, tool_choice: "auto" } : {}) };
    const controller = new AbortController();
    this.running.set(message.id, controller);
    const timer = setTimeout(() => controller.abort(), this.limits.requestTimeoutMs);
    // A provider's error text is passed on for the visitor to read, but never with the key in it.
    const scrub = text => String(text).split(setup.key).join("[key]");
    try {
      const router = setup.router.replace(/\/$/, "");
      const response = await this.fetch(`${router}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${setup.key}`, ...(hostOf(router) === "api.anthropic.com" ? { "anthropic-dangerous-direct-browser-access": "true" } : {}) },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (this.session !== session) { await response.body?.cancel().catch(() => {}); return; }
      send("head", { status: response.status, contentType: response.headers.get("content-type") || "text/event-stream" });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      // Keep a short tail: a provider error may echo a key across two transport chunks.
      let buffered = "";
      const forward = (text, final = false) => {
        buffered += text;
        const limit = final ? buffered.length : Math.max(0, buffered.length - setup.key.length + 1);
        let offset = 0, safe = "";
        while (offset < limit) {
          const match = buffered.indexOf(setup.key, offset);
          if (match < 0 || match >= limit) {
            safe += buffered.slice(offset, limit);
            offset = limit;
          } else {
            safe += buffered.slice(offset, match) + "[key]";
            offset = match + setup.key.length;
          }
        }
        buffered = buffered.slice(offset);
        if (safe) send("chunk", { text: safe });
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        // A session closed mid-answer gets nothing further.
        if (this.session !== session) { await reader.cancel().catch(() => {}); return; }
        forward(decoder.decode(value, { stream: true }));
      }
      if (this.session !== session) return;
      forward(decoder.decode(), true);
      send("end", {});
    } catch (error) {
      if (this.session === session) refuse(controller.signal.aborted ? 499 : 502, controller.signal.aborted ? "The request was stopped." : scrub(`The AI provider could not be reached: ${error?.message || error}`).slice(0, 300));
    } finally {
      clearTimeout(timer);
      this.running.delete(message.id);
    }
  }
}

// The reservation page's side of the AI relay, used only inside the finder site's frame.
// The visitor set their LLM provider and key on the finder site. This page never gets
// that key: its assistant sends model requests to the shop's own bridge address, the
// service worker hands them to this module, and this module passes them to the finder
// site, which calls the provider. Messages are exchanged only with the registered finder
// origin and the window that frames this page.

const CONTROL_TIMEOUT_MS = 8000;

/**
 * Connects this framed page to the finder site's relay and carries requests across.
 */
export class RelayClient {
  /**
   * :param options: parentOrigin (the registered finder site), shop (this shop's id), base
   *   (the shop's path, such as "/s/akari", or "" on its own host), and optional window
   *   and onState stand-ins.
   */
  constructor(options) {
    this.parentOrigin = options.parentOrigin;
    this.shop = options.shop;
    this.base = options.base;
    this.window = options.window || globalThis.window;
    this.onState = options.onState || (() => {});
    this.session = null;
    this.state = "idle";
    this.reason = "";
    this.pending = new Map();
    this.sequence = 0;
    this.waiting = null;
    this.workerMessage = (event) => this.fromWorker(event);
    this.parentMessage = (event) => this.fromParent(event);
  }

  /** The address the runtime is given as its LLM router: on this shop's origin, answered by the service worker. */
  get bridgeUrl() {
    return new URL(`${this.base}/agent/llm-bridge/v1`, this.window.location.origin).href;
  }

  setState(state, reason = "") {
    this.state = state;
    this.reason = reason;
    this.onState(state, reason);
  }

  /**
   * Take control of the bridge address, then ask the finder site to open a relay and
   * wait for the visitor's answer there.
   *
   * :return: {router, key, model} for the runtime once the relay is open. The key is a
   *   session label, not a credential: the finder site checks the frame and the session itself.
   * :raises Error: When service workers are unavailable, the finder declines, or it closes first.
   */
  async connect() {
    const workers = this.window.navigator.serviceWorker;
    if (!workers) {
      this.setState("unsupported");
      throw new Error("Service workers are not available.");
    }
    this.setState("preparing");
    let timer;
    try {
      const scriptUrl = new URL(`${this.base}/agent/llm-relay-sw.js`, this.window.location.origin).href;
      await Promise.race([
        workers.register(scriptUrl, { scope: `${this.base}/` }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("The service worker registration timed out.")), CONTROL_TIMEOUT_MS);
        }),
      ]);
      await this.controlled(workers, scriptUrl);
    } catch (error) {
      this.setState("unsupported");
      throw error;
    } finally {
      clearTimeout(timer);
    }
    workers.addEventListener("message", this.workerMessage);
    this.window.addEventListener("message", this.parentMessage);
    this.window.addEventListener("pagehide", () => this.close("closed"), { once: true });
    this.setState("waiting");
    const opened = new Promise((resolve, reject) => {
      this.waiting = { resolve: resolve, reject: reject };
    });
    this.toParent({ type: "gemihub:relay-hello", version: 1, shop: this.shop });
    return opened;
  }

  /** Wait until the service worker controls this page: until then, the bridge address would reach the server. */
  controlled(workers, scriptUrl) {
    const ready = () => workers.controller?.scriptURL === scriptUrl;
    if (ready()) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const changed = () => {
        if (!ready()) return;
        clearTimeout(timer);
        workers.removeEventListener("controllerchange", changed);
        resolve();
      };
      const timer = setTimeout(() => {
        workers.removeEventListener("controllerchange", changed);
        reject(new Error("The service worker did not take control of the page."));
      }, CONTROL_TIMEOUT_MS);
      workers.addEventListener("controllerchange", changed);
      changed();
    });
  }

  toParent(message) {
    // Addressed to the registered finder site alone.
    this.window.parent.postMessage(message, this.parentOrigin);
  }

  /** A model request from the service worker: pass it on while a relay is open, refuse it otherwise. */
  fromWorker(event) {
    const data = event.data;
    const port = event.ports?.[0];
    if (event.source !== this.window.navigator.serviceWorker.controller || !data || data.type !== "gemihub:llm-request" || !port) {
      return;
    }
    if (!this.session) {
      port.postMessage({ type: "error", status: 503, message: "The AI relay is not connected. Reconnect it on the restaurant finder site." });
      port.close();
      return;
    }
    this.sequence += 1;
    const id = `${this.session}:${this.sequence}`;
    this.pending.set(id, port);
    port.onmessage = (message) => {
      if (message.data?.type === "abort" && this.pending.delete(id)) {
        this.toParent({ type: "gemihub:llm-abort", session: this.session, id: id });
        port.close();
      }
    };
    this.toParent({ type: "gemihub:llm-request", session: this.session, id: id, path: data.path, body: data.body });
  }

  /** A message from the finder site. Anything from another origin or window is ignored. */
  fromParent(event) {
    if (event.origin !== this.parentOrigin || event.source !== this.window.parent) {
      return;
    }
    const data = event.data;
    if (!data || typeof data.type !== "string") {
      return;
    }
    if (data.type === "gemihub:relay-open" && this.waiting && typeof data.session === "string" && typeof data.model === "string") {
      this.session = data.session;
      this.setState("open");
      this.waiting.resolve({ router: this.bridgeUrl, key: `relay-${data.session}`, model: data.model });
      this.waiting = null;
    } else if (data.type === "gemihub:relay-denied" || data.type === "gemihub:relay-closed") {
      if (data.type === "gemihub:relay-closed" && data.session !== this.session) {
        return;
      }
      this.close(data.type === "gemihub:relay-denied" ? "denied" : "closed", typeof data.reason === "string" ? data.reason.slice(0, 300) : "");
    } else if (data.session === this.session && this.pending.has(data.id)) {
      const port = this.pending.get(data.id);
      if (data.type === "gemihub:llm-head") {
        port.postMessage({ type: "head", status: data.status, contentType: data.contentType });
      } else if (data.type === "gemihub:llm-chunk") {
        port.postMessage({ type: "chunk", text: data.text });
      } else if (data.type === "gemihub:llm-end" || data.type === "gemihub:llm-error") {
        this.pending.delete(data.id);
        port.postMessage(data.type === "gemihub:llm-end" ? { type: "end" } : { type: "error", status: data.status, message: data.message });
        port.close();
      }
    }
  }

  /** The relay is over: fail what was in flight, and refuse what comes next. */
  close(state, reason) {
    for (const [id, port] of this.pending) {
      this.toParent({ type: "gemihub:llm-abort", session: this.session, id: id });
      port.postMessage({ type: "error", status: 503, message: "The AI relay was closed." });
      port.close();
    }
    this.session = null;
    this.pending.clear();
    this.setState(state, reason);
    if (this.waiting) {
      this.waiting.reject(new Error(reason || "The finder site did not open the AI relay."));
      this.waiting = null;
    }
  }

  dispose() {
    this.close("closed");
    this.window.navigator.serviceWorker?.removeEventListener("message", this.workerMessage);
    this.window.removeEventListener("message", this.parentMessage);
  }
}

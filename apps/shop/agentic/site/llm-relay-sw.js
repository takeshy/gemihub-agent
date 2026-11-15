// Service worker of a restaurant's reservation page, used only inside the finder site's frame.
// It answers requests to this shop's own bridge address, <scope>agent/llm-bridge/v1/, by
// handing them to the page, which passes them to the finder site; that site calls the
// visitor's LLM provider with the visitor's key and sends the answer back. No key is ever
// here: the worker sees the request the runtime made and the provider's reply, nothing else.
// Every other request is left alone, and nothing is ever forwarded to another address.

const BRIDGE = new URL("agent/llm-bridge/v1/", self.registration.scope).href;
const PATHS = ["chat/completions", "models"];
const REQUEST_TIMEOUT_MS = 125000;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (!event.request.url.startsWith(BRIDGE)) {
    return;
  }
  event.respondWith(relay(event));
});

function refusal(status, message) {
  return new Response(JSON.stringify({ error: { message: message, type: "relay_error" } }), {
    status: status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function relay(event) {
  const request = event.request;
  const path = request.url.slice(BRIDGE.length).split("?")[0];
  if (!PATHS.includes(path) || request.method !== (path === "chat/completions" ? "POST" : "GET")) {
    return refusal(404, "This address relays only chat completions and the model list.");
  }
  const client = event.clientId ? await self.clients.get(event.clientId) : null;
  if (!client) {
    return refusal(503, "The AI relay has no page to pass the request to. Reload the restaurant's page.");
  }
  const body = request.method === "POST" ? await request.text() : "";
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const port = channel.port1;
    const encoder = new TextEncoder();
    let controller = null;
    let answered = false;
    let finished = false;
    let complete;
    event.waitUntil(new Promise((done) => { complete = done; }));
    const finish = () => {
      finished = true;
      clearTimeout(timer);
      request.signal.removeEventListener("abort", aborted);
      port.close();
      complete();
    };
    const fail = (status, message) => {
      if (finished) return;
      if (!answered) {
        answered = true;
        resolve(refusal(status, message));
      } else if (controller) {
        controller.error(new Error(message));
      }
      finish();
    };
    const aborted = () => {
      port.postMessage({ type: "abort" });
      fail(499, "The AI relay request was stopped.");
    };
    // Bound the entire stream too, including a parent that disappears after sending headers.
    const timer = setTimeout(() => {
      port.postMessage({ type: "abort" });
      fail(504, "The AI relay did not answer in time.");
    }, REQUEST_TIMEOUT_MS);
    port.onmessage = ({ data }) => {
      if (finished || !data) return;
      if (data.type === "head" && !answered) {
        if (!Number.isInteger(data.status) || data.status < 200 || data.status > 599 || [204, 205, 304].includes(data.status)) {
          fail(502, "The AI relay returned an invalid response status.");
          return;
        }
        answered = true;
        const stream = new ReadableStream({
          start(streamController) {
            controller = streamController;
          },
          cancel() {
            port.postMessage({ type: "abort" });
            finish();
          },
        });
        resolve(new Response(stream, {
          status: data.status,
          headers: { "Content-Type": data.contentType || "text/event-stream", "Cache-Control": "no-store" },
        }));
      } else if (data.type === "chunk" && controller) {
        controller.enqueue(encoder.encode(data.text));
      } else if (data.type === "end" && controller) {
        controller.close();
        finish();
      } else if (data.type === "error") {
        fail(data.status || 502, data.message || "The AI relay failed.");
      }
    };
    request.signal.addEventListener("abort", aborted, { once: true });
    if (request.signal.aborted) { aborted(); return; }
    client.postMessage({ type: "gemihub:llm-request", path: path, body: body }, [channel.port2]);
  });
}

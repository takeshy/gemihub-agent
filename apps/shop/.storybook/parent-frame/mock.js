// Storybook-only loader for the parent finder (site/) and its administration page (admin/).
// It loads the real HTML, CSS and JavaScript, answers every /api/ request from fixtures in this
// frame, and never contacts a live server. The story passes its scenario as ?c=<JSON>.
(async () => {
  const config = JSON.parse(new URLSearchParams(location.search).get("c") || "{}");
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  const absolute = path => new URL(path, location.href).href;
  const sessionKey = `parent-story-signed-out:${location.search}`;
  const stored = () => { try { return sessionStorage.getItem(sessionKey) === "1"; } catch { return false; } };
  const store = value => { try { value ? sessionStorage.setItem(sessionKey, "1") : sessionStorage.removeItem(sessionKey); } catch { /* Stories still render. */ } };

  function admin() {
    let user = config.user === false || stored() ? null : { email: "operator@example.com" };
    const configured = config.configured !== false;
    let state = { version: 1, shops: config.shops || [], cache: config.cache || {}, revision: "1", production: true };
    const next = message => { state = { ...state, revision: String(Number(state.revision) + 1), message }; return json(state); };
    return (url, method, body) => {
      const path = url.pathname;
      if (path === "/api/session") return json({ user, configured, ...(configured ? {} : { setupMessage: "運営者のGoogleログインがまだ設定されていません。" }) });
      if (path === "/api/logout") { user = null; store(true); return json({ ok: true }); }
      if (!user) return json({ error: "運営者としてGoogleにログインしてください" }, 401);
      if (path === "/api/site") return json({ publicUrl: absolute("../parent-site/index.html") });
      if (path === "/api/shops" && method === "GET") return json(state);
      if (path === "/api/shops" && method === "PUT") {
        const fetchedAt = "2026-11-16T09:00:00.000Z";
        const cache = Object.fromEntries(body.shops.map(shop => [shop.id, { status: "connected", fetchedAt, ...state.cache[shop.id], ...body.cache?.[shop.id] }]));
        state = { ...state, shops: body.shops, cache };
        return next("保存しました。公開サイトを再読み込みすると反映されます。");
      }
      const removed = path.match(/^\/api\/shops\/([^/]+)$/);
      if (removed && method === "DELETE") {
        state = { ...state, shops: state.shops.filter(shop => shop.id !== decodeURIComponent(removed[1])) };
        return next("削除しました。公開サイトを再読み込みすると反映されます。");
      }
      if (path === "/api/resolve") {
        if (!/^https?:\/\//.test(body.url || "")) return json({ error: "店のURLを確認してください" }, 400);
        const current = state.shops.find(shop => shop.id === body.id);
        const fresh = { id: "komorebi-zakka", name: "こもれび雑貨店", area: "東京都世田谷区", address: "東京都世田谷区北沢２丁目１０", cuisine: "雑貨・生活雑貨", description: "作家の器と文具をそろえた小さな雑貨店です。", pageUrl: new URL("/", body.url).href, reservationEnabled: false };
        return json({ shop: current ? { ...current, description: `${current.description || ""}（店のページから取り直した紹介文）` } : fresh, cache: { status: "connected", fetchedAt: "2026-11-16T09:00:00.000Z" } });
      }
      if (path === "/api/invitations") return json({ ok: true, message: "招待メールを送りました。" });
    };
  }

  function site() {
    const managed = config.ai !== "byok", model = "gemini-4-hydrogen";
    const answer = "Storybookの固定の返答です。実際のAIには接続していません。";
    return (url, method) => {
      const path = url.pathname;
      if (path === "/api/ai/config") return json({ managed, defaultMode: managed ? "managed" : "byok", model: managed ? model : "", reasoning: "low", router: "/api/ai/v1" });
      if (path === "/api/ai/session") return json({ token: "storybook-session", expiresIn: 7200, model, router: "/api/ai/v1" });
      if (path === "/api/ai/v1/models") return json({ object: "list", data: [{ id: model, object: "model" }] });
      if (path === "/api/ai/v1/chat/completions" && method === "POST") {
        return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: answer }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } });
      }
    };
  }

  const pages = {
    admin: {
      url: "../parent-admin/index.html", handler: admin,
      rewrite: html => html.replace('href="/admin.css"', 'href="../parent-admin/admin.css"').replace('src="/admin.js"', 'src="../parent-admin/admin.js"'),
      // admin.js imports its helpers from the administration server's root.
      imports: { "/shop-data.js": absolute("../parent-site/shop-data.js"), "/site-editor.js": absolute("../parent-admin/site-editor.js") },
    },
    site: {
      url: "../parent-site/index.html", handler: site,
      rewrite: html => html.replace(/(href|src)="\.\/([\w.-]+\.(?:css|js))"/g, '$1="../parent-site/$2"'),
      // The generated registry reflects local shops; stories use their own fixture shops.
      imports: { [absolute("../parent-site/shop-registry.js")]: `data:text/javascript;charset=utf-8,${encodeURIComponent(`export const shops = ${JSON.stringify(config.shops || [])};`)}` },
    },
  };
  const page = pages[config.page];
  if (!page) { document.body.textContent = "Unknown story page"; return; }
  const realFetch = window.fetch.bind(window), handle = page.handler();
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
    // The runtime probes the AI router's origin for an agent manifest; the managed router has none.
    if (url.origin === location.origin && url.pathname === "/agent-manifest.json") return json({ error: "Not found" }, 404);
    if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return realFetch(input, init);
    const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : undefined;
    return await handle(url, (init.method || "GET").toUpperCase(), body) || json({ error: "Storybookでは使えない操作です" }, 404);
  };
  const html = page.rewrite(await (await realFetch(page.url)).text())
    .replace("<head>", `<head><script type="importmap">${JSON.stringify({ imports: page.imports }).replace(/</g, "\\u003c")}</script>`);
  document.open(); document.write(html); document.close();
  // document.open() drops earlier listeners, so add them to the written page.
  window.addEventListener("click", event => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("#google-login")) { event.preventDefault(); store(false); location.reload(); return; }
    if (target?.closest("#site-design-toggle")) {
      event.stopImmediatePropagation();
      const message = document.getElementById("message");
      if (message) { message.textContent = "Storybookでは「ページ編集」のストーリーで確認できます。"; message.hidden = false; }
      return;
    }
    // Keep ordinary links from leaving the story; in-page anchors and new tabs behave as usual.
    const link = target?.closest("a[href]");
    if (link && !link.getAttribute("href").startsWith("#") && link.target !== "_blank") event.preventDefault();
  }, true);
  if (config.open === "add") {
    const timer = setInterval(() => {
      const add = document.getElementById("add-shop");
      if (!add || add.disabled || document.getElementById("registry").hidden) return;
      clearInterval(timer); add.click();
      document.getElementById("source-url").value = "https://komorebi-zakka.example/";
      document.getElementById("resolve-form").requestSubmit();
    }, 50);
  }
})();

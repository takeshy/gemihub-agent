import type { storefrontAssistant } from "../../apps/shop/server/agentic.ts";
import { escapeHtml } from "../../apps/shop/server/artifacts.ts";

type RetailDetails = { name: string; area: string; hours: string; products: string[] };
type Guide = Pick<ReturnType<typeof storefrontAssistant>, "attributes" | "head" | "body">;

export function renderChallengeRetail(base: string, retail: RetailDetails, guide: Guide) {
  const name = escapeHtml(retail.name);
  const products = retail.products.map(item => `<li>${escapeHtml(item)}</li>`).join("");
  return `<!doctype html>
  <html lang="ja"${guide.attributes}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${name}</title><meta name="description" content="作家の器、手帳、紙雑貨、贈り物用の文具を扱う架空のデモ店舗。">
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f4eddf; color: #292635; font: 1rem/1.65 "BIZ UDPGothic", system-ui, sans-serif; }
    .komado { width: min(100%, 86rem); margin: 0 auto; padding: clamp(1.1rem, 4vw, 3.7rem) clamp(1rem, 5vw, 5rem) 5rem; }
    .komado h1, .komado h2, .komado p, .komado figure { margin: 0; }
    .komado h1, .komado h2 { font-family: "Yu Mincho", "Hiragino Mincho ProN", serif; line-height: 1.18; }
    .komado h1 { font-size: clamp(2.1rem, 5.3vw, 4.8rem); overflow-wrap: anywhere; }
    .komado h2 { font-size: clamp(1.55rem, 3vw, 2.6rem); }
    .komado a { color: inherit; }
    .komado-mast { padding: .7rem 0 1.1rem; border-top: 3px double #554961; }
    .komado p.komado-area { color: #5d4866; font-size: .82rem; margin-bottom: .45rem; }
    .komado-title { display: flex; justify-content: space-between; align-items: baseline; gap: .6rem 2rem; flex-wrap: wrap; }
    .komado-nav { display: flex; flex-wrap: wrap; gap: .3rem 1rem; font-size: .88rem; }
    .komado-nav a { display: inline-block; padding: .45rem 0; text-underline-offset: .25em; }
    .komado-showcase { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.34fr); border-block: 1px solid #a79aaa; }
    .komado-catalog { background: #e8dfed; padding: clamp(1.35rem, 4vw, 3.6rem); align-content: center; }
    .komado p.komado-intro { margin: .7rem 0 1.2rem; max-width: 25rem; }
    .komado-products { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 0; padding: 0; list-style: none; border-inline-start: 1px solid #a79aaa; border-top: 1px solid #a79aaa; }
    .komado-products li { border-inline-end: 1px solid #a79aaa; border-bottom: 1px solid #a79aaa; min-height: 4.1rem; padding: .75rem; align-content: center; overflow-wrap: anywhere; font-weight: 650; }
    .komado-photo { position: relative; min-height: 24rem; }
    .komado-photo img { position: absolute; inset: 0; width: 100%; height: 100%; display: block; object-fit: cover; object-position: 52% 50%; }
    .komado-photo figcaption { position: absolute; right: .75rem; bottom: .75rem; background: #282032; color: #fff7ef; font-size: .7rem; padding: .2rem .55rem; }
    .komado-visit { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, .8fr); gap: 1rem 2rem; align-items: center; margin-top: 1.3rem; padding-block: 1.1rem; border-bottom: 1px solid #a79aaa; }
    .komado-visit p { margin-top: .2rem; }
    .komado-visit strong { color: #563f65; font-size: 1.28rem; }
    .komado-place { display: flex; align-items: center; gap: .8rem; }
    .komado-place img { width: clamp(4rem, 9vw, 7rem); aspect-ratio: 4 / 3; object-fit: cover; }
    .komado-place figcaption { font-size: .8rem; }
    .komado p.komado-demo { margin-top: .9rem; font-size: .8rem; }
    #assistant-toggle.restaurant-ai-toggle { background: #563f65; }
    @media (max-width: 670px) {
      .komado-showcase, .komado-visit { grid-template-columns: 1fr; }
      .komado-photo { min-height: 0; aspect-ratio: 16 / 10; }
    }
  </style>${guide.head}</head><body>
  <main class="komado">
    <header class="komado-mast">
      <p class="komado-area">横浜・大倉山の雑貨店</p>
      <div class="komado-title">
        <h1>${name}</h1>
        <nav class="komado-nav" aria-label="ページ内案内"><a href="#products">取扱品</a><a href="#visit">営業時間・場所</a></nav>
      </div>
    </header>
    <div class="komado-showcase">
      <section id="products" class="komado-catalog" aria-labelledby="komado-catalog-heading">
        <h2 id="komado-catalog-heading">店頭に並ぶもの</h2>
        <p class="komado-intro">毎日使う器と、手に取りたくなる紙もの。</p>
        <ul class="komado-products">${products}</ul>
      </section>
      <figure class="komado-photo"><img src="${base}/demo-photo.webp" alt="作家の器や紙ものが並ぶ棚"><figcaption>商品のイメージ</figcaption></figure>
    </div>
    <section id="visit" class="komado-visit" aria-labelledby="komado-visit-heading">
      <div><h2 id="komado-visit-heading">営業時間・場所</h2><p><strong>${escapeHtml(retail.hours)}</strong></p><p>${escapeHtml(retail.area)}</p></div>
      <figure class="komado-place"><img src="${base}/okurayama.webp" alt=""><figcaption>大倉山の梅園</figcaption></figure>
    </section>
    <p class="komado-demo">架空のデモ店舗</p>
  </main>${guide.body}</body></html>`;
}

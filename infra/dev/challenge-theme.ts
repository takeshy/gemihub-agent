import { escapeHtml } from "../../apps/shop/server/artifacts.ts";
import type { ShopConfig } from "../../apps/shop/server/domain.ts";
import { currencyOf, formatMoney, regionOf } from "../../apps/shop/shared/region.ts";
import { defaultAppearance, standardTheme } from "../../apps/shop/shared/theme-editing.ts";

const commonHeader = `
  .store-mast h1 { margin: 0; line-height: 1.15; overflow-wrap: anywhere; }
  .store-mast p { margin: 0; }
  .store-mast [data-design-slot=subtitle] p { line-height: 1.8; }
  .store-mast figure { margin: 0; position: relative; min-width: 0; }
  .store-mast [data-design-slot=image] { height: 100%; }
  .store-mast .salon-image { width: 100%; height: 100%; max-height: none; margin: 0; border-radius: 0; object-fit: cover; }
  .store-mast figcaption { position: absolute; right: .75rem; bottom: .75rem; padding: .2rem .55rem; background: #19110de8; color: #fff5ea; font-size: .7rem; }
  .store-mast .salon-details { margin-top: .85rem; flex-wrap: wrap; gap: .35rem 1rem; color: inherit; font-size: .85rem; }
  .store-mast .demo-note { margin-top: .8rem; font-size: .75rem; }
  .store-mast .public-nav { margin: 0; padding: .45rem 0; gap: .25rem .8rem; }
  .store-mast .public-nav a { padding: .65rem .75rem; color: inherit; font-size: .875rem; font-weight: 650; }
  .store-mast .public-nav a:hover { text-decoration: underline; text-underline-offset: .25em; }
  .store-mast .public-nav a[href*="/reserve"] { background: var(--nav-action, var(--green)); color: var(--nav-action-ink, white); }
`;
const commonAbout = `
  .store-about { margin-inline: auto; max-width: 74rem; }
  .store-about :is(h2,h3,p,figure) { margin: 0; }
  .store-about :is(h2,h3) { color: inherit; line-height: 1.3; }
  .store-about h2 { font-size: clamp(1.6rem, 3.2vw, 2.45rem); }
  .store-about h3 { font-size: 1rem; }
  .store-about p { margin-block: .35rem 0; line-height: 1.7; }
  .store-about .menu-row { display: block; padding: .8rem 0; margin: 0; border-bottom: 1px solid var(--line); line-height: 1.55; }
  .store-about .menu-row b { white-space: nowrap; }
  .store-about [data-design-slot=access] p { overflow-wrap: anywhere; }
`;

function menuFeature(config: ShopConfig, id: string) {
  const menu = config.menus.find(menu => menu.id === id);
  if (!menu?.ingredients) throw new Error(`Missing featured menu or ingredients for ${id} in ${config.name}`);
  return `<article class="featured-menu">
    <h3>${escapeHtml(menu.name)}</h3><strong>${formatMoney(menu.price, currencyOf(regionOf(config)))}</strong>
    <p>${escapeHtml(menu.ingredients.join("・"))}</p>
    ${menu.allergenNote ? `<p class="menu-note">${escapeHtml(menu.allergenNote)}</p>` : ""}
  </article>`;
}

const restaurants = {
  akari: {
    colors: { ink: "#312017", paper: "#f5eee4", line: "#dbc9b6", action: "#84402a" },
    header: `<header class="store-mast akari-mast">
      <div class="akari-nav"><slot name="navigation"></slot></div>
      <div class="akari-hero">
        <div class="akari-copy">
          <p class="akari-genre">横浜・大倉山の炉端焼き</p>
          <slot name="title"></slot><slot name="subtitle"></slot><slot name="details"></slot>
          <p class="demo-note">架空のデモ店舗</p>
        </div>
        <figure class="akari-photo"><slot name="image"></slot><figcaption>料理のイメージ</figcaption></figure>
      </div>
    </header>`,
    headerCss: `
      .akari-mast { background: #261b16; color: #fff1dd; --nav-action: #eac295; --nav-action-ink: #28180d; }
      .akari-nav { border-bottom: 1px solid #634635; padding-inline: clamp(1rem, 4vw, 4rem); }
      .akari-nav .public-nav { max-width: 78rem; margin-inline: auto; justify-content: flex-end; }
      .akari-hero { max-width: 82rem; margin: auto; display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); min-height: 24rem; }
      .akari-copy { grid-column: 2; grid-row: 1; align-self: center; padding: clamp(1.4rem, 5vw, 4rem); }
      .akari-copy h1 { font: 700 clamp(2.75rem, 6vw, 5.25rem)/1.1 "Yu Mincho", "Hiragino Mincho ProN", serif; margin: .15em 0 .32em; }
      .akari-copy .akari-genre { color: #eac295; font-size: .85rem; }
      .akari-photo { grid-column: 1; grid-row: 1; }
      .akari-photo .salon-image { position: absolute; inset: 0; object-position: 46% 53%; }
      @container storefront (max-width: 650px) {
        .akari-hero { grid-template-columns: 1fr; min-height: 0; }
        .akari-copy, .akari-photo { grid-column: auto; grid-row: auto; }
        .akari-photo { aspect-ratio: 16 / 8; }
        .akari-nav .public-nav { justify-content: flex-start; }
      }`,
    about: (config: ShopConfig) => `<div class="store-about akari-about">
      <section>
        <h2>炭火のコースと一品</h2>${menuFeature(config, "winter-robata")}
        <details><summary>すべてのメニューを見る</summary><slot name="menus"></slot></details>
      </section>
      <aside class="akari-visit">
        <h2>ご来店案内</h2><p>カウンター、小上がり、宴会まで。お席だけのご予約も承ります。</p>
        <h3>場所</h3><slot name="access"></slot>
      </aside>
    </div>`,
    aboutCss: `
      .akari-about { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: clamp(1.5rem, 6vw, 6rem); }
      .akari-about h2 { font-family: "Yu Mincho", "Hiragino Mincho ProN", serif; margin-bottom: .6rem; }
      .akari-about .featured-menu { border-block: 1px solid var(--line); padding: .9rem 0; }
      .akari-about .featured-menu h3 { display: inline; margin-right: .85rem; }
      .akari-about .menu-note { font-size: .86rem; }
      .akari-about summary { padding: .7rem 0; cursor: pointer; }
      .akari-visit { border-top: .3rem solid #84402a; background: #ebddce; align-self: start; padding: clamp(1rem, 3vw, 2rem); }
      .akari-visit h3 { margin-top: 1rem; }
      @container storefront (max-width: 650px) { .akari-about { grid-template-columns: 1fr; } }`,
  },
  "trattoria-sole": {
    colors: { ink: "#253a2d", paper: "#fbf7e9", line: "#d2d7c2", action: "#37583e" },
    header: `<header class="store-mast sole-mast">
      <div class="sole-name">
        <p class="sole-genre">大倉山のトラットリア</p><slot name="title"></slot>
        <slot name="subtitle"></slot>
      </div>
      <div class="sole-nav"><slot name="navigation"></slot></div>
      <figure class="sole-photo"><slot name="image"></slot><figcaption>料理のイメージ</figcaption></figure>
      <p class="demo-note">架空のデモ店舗</p>
    </header>`,
    headerCss: `
      .sole-mast { padding: clamp(1.25rem, 4vw, 3.4rem) clamp(1rem, 5vw, 5rem) .6rem; background: #fbf7e9; text-align: center; }
      .sole-name h1 { font: 600 clamp(2rem, 5vw, 4.25rem)/1.15 Baskervville, "Yu Mincho", "Hiragino Mincho ProN", serif; margin: .16em 0 .3em; }
      .sole-name [data-design-slot=subtitle] { max-width: 42rem; margin: auto; }
      .sole-name .sole-genre { color: #435b40; font-size: .85rem; }
      .sole-nav { max-width: 70rem; margin: 1.2rem auto 1rem; border-block: 1px solid #a7ad93; }
      .sole-nav .public-nav a[href*="/reserve"] { border-radius: 2rem; }
      .sole-mast .sole-photo { margin-inline: auto; width: min(100%, 70rem); height: clamp(11rem, 32vw, 24rem); }
      .sole-photo .salon-image { object-position: 50% 58%; }
      .sole-mast .demo-note { max-width: 70rem; margin-inline: auto; text-align: left; }`,
    about: (config: ShopConfig) => `<div class="store-about sole-about">
      <section class="sole-feature"><h2>薪窯から、テーブルへ</h2><div>${menuFeature(config, "margherita")}</div></section>
      <section class="sole-list"><h2>メニュー</h2><slot name="menus"></slot></section>
      <section class="sole-visit">
        <div><h2>お店のこと</h2><p>手打ちパスタやワインを囲む食事に。貸切パーティーも承ります。</p></div>
        <div><h3>営業時間</h3><slot name="hours"></slot><h3>場所</h3><slot name="access"></slot></div>
      </section>
    </div>`,
    aboutCss: `
      .sole-feature, .sole-visit { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 1rem 2.5rem; }
      .sole-feature { align-items: center; border-block: 1px solid #a7ad93; padding: clamp(1rem, 3vw, 2rem) 0; }
      .sole-about h2 { font-family: Baskervville, "Yu Mincho", serif; }
      .sole-feature h3 { display: inline; padding-right: 1rem; }
      .sole-list { width: min(100%, 50rem); margin: clamp(1.65rem, 4vw, 3.4rem) auto; }
      .sole-visit { background: #e9ead8; padding: clamp(1rem, 3vw, 2rem); }
      .sole-visit h3:not(:first-child) { margin-top: .9rem; }
      @container storefront (max-width: 650px) { .sole-feature, .sole-visit { grid-template-columns: 1fr; } }`,
  },
  "kanton-ryu": {
    colors: { ink: "#452226", paper: "#fbf2e5", line: "#d9bdb1", action: "#862c37" },
    header: `<header class="store-mast ryu-mast">
      <div class="ryu-stage">
        <figure class="ryu-photo"><slot name="image"></slot><figcaption>料理のイメージ</figcaption></figure>
        <div class="ryu-sign">
          <p class="ryu-genre">大倉山の広東料理</p>
          <slot name="title"></slot><slot name="subtitle"></slot>
          <p class="demo-note">架空のデモ店舗</p>
        </div>
      </div>
      <div class="ryu-nav"><slot name="navigation"></slot></div>
    </header>`,
    headerCss: `
      .ryu-mast { background: #631f2a; color: #fff6e7; --nav-action: #f2cf96; --nav-action-ink: #421923; }
      .ryu-stage { max-width: 86rem; margin: auto; display: grid; grid-template-areas: "stage"; align-items: center; min-height: 27rem; }
      .ryu-mast .ryu-photo { grid-area: stage; align-self: stretch; }
      .ryu-photo .salon-image { position: absolute; inset: 0; object-position: 50% 57%; }
      .ryu-photo figcaption { z-index: 1; }
      .ryu-photo::after { content: ""; position: absolute; inset: 0; background: linear-gradient(0deg, #31141c8c, #31141c26); }
      .ryu-sign { grid-area: stage; z-index: 1; width: min(calc(100% - 2rem), 32rem); justify-self: center; padding: clamp(1.35rem, 4vw, 2.9rem); margin: 2rem 0; text-align: center; background: #631f2a; border: 4px double #eec78b; box-shadow: 0 .6rem 2rem #200c14a8; }
      .ryu-sign h1 { font: 700 clamp(2.6rem, 7vw, 5.6rem)/1.05 "Yu Mincho", "Hiragino Mincho ProN", serif; color: #ffe1aa; margin: .16em 0 .25em; letter-spacing: .08em; }
      .ryu-sign .ryu-genre { font-size: .85rem; color: #ffdaa2; }
      .ryu-nav { padding: .25rem 1rem; border-top: 1px solid #eec78b; }
      @container storefront (max-width: 650px) {
        .ryu-stage { min-height: 23rem; }
        .ryu-sign { width: min(calc(100% - 2.75rem), 32rem); }
      }`,
    about: (config: ShopConfig) => {
      const { seating } = config;
      if (!seating) throw new Error(`Missing seating configuration for ${config.name}`);
      return `<div class="store-about ryu-about">
      <section class="ryu-courses">
        <h2>円卓を囲むコース</h2>
        <p>ご予約は${seating.minPartySize}〜${seating.maxPartySize}名様、コースで承ります。</p>
        <div class="ryu-course-grid">${menuFeature(config, "round-table")}${menuFeature(config, "veggie-table")}</div>
        <details><summary>すべてのメニューを見る</summary><slot name="menus"></slot></details>
      </section>
      <section class="ryu-visit">
        <div><h3>営業時間</h3><slot name="hours"></slot></div>
        <div><h3>場所</h3><slot name="access"></slot></div>
      </section>
    </div>`;
    },
    aboutCss: `
      .ryu-courses > :is(h2,p) { text-align: center; }
      .ryu-courses > h2 { font-family: "Yu Mincho", "Hiragino Mincho ProN", serif; color: #722632; }
      .ryu-course-grid, .ryu-visit { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
      .ryu-course-grid { margin-block: 1.4rem; }
      .ryu-course-grid article { background: #fff9f0; border: 1px solid #d9bdb1; border-top: .26rem solid #862c37; padding: clamp(1rem, 3vw, 2rem); }
      .ryu-course-grid h3 { margin-bottom: .35rem; font-size: 1.25rem; }
      .ryu-course-grid .menu-note { font-size: .86rem; }
      .ryu-courses summary { padding: .7rem 0; cursor: pointer; }
      .ryu-visit { margin-top: 1.5rem; padding-block: 1.15rem; border-block: 1px solid #d9bdb1; }
      @container storefront (max-width: 590px) { .ryu-course-grid, .ryu-visit { grid-template-columns: 1fr; } }`,
  },
};

export function decorateRestaurant(config: ShopConfig, slug: string) {
  if (!Object.hasOwn(restaurants, slug)) throw new Error(`Missing challenge storefront design for ${slug}`);
  const design = restaurants[slug as keyof typeof restaurants];
  const { ink, paper, line, action } = design.colors;
  config.header.subtitle = config.description;
  config.appearance = {
    ...defaultAppearance,
    ...config.appearance,
    theme: {
      ...standardTheme,
      headerHtml: design.header,
      headerCss: commonHeader + design.headerCss,
      bodyHtml: '<div class="store-body"><div class="store-content"><slot name="content"></slot></div></div>',
      bodyCss: ".store-body { background: var(--cream); } .store-content { max-width: 82rem; margin: auto; padding: clamp(1.15rem, 4vw, 3.25rem) clamp(1rem, 5vw, 4rem); }",
      footerCss: ".site-footer { margin: 0; padding: 1.4rem 1rem 4rem; background: var(--cream); color: inherit; text-align: center; }",
      css: `:root { color: ${ink}; --ink: ${ink}; --cream: ${paper}; --line: ${line}; --green: ${action}; }`,
    },
  };
  config.screens = { ...config.screens, about: { html: design.about(config), css: commonAbout + design.aboutCss } };
}

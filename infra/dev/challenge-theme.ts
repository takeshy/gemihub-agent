import type { ShopConfig } from "../../apps/shop/server/domain.ts";
import { standardTheme } from "../../apps/shop/shared/theme-editing.ts";

export const shopDesigns = {
  akari: { genre: "炉端焼き", ink: "#572e23", paper: "#f5e7d7", accent: "#874a37" },
  "trattoria-sole": { genre: "薪窯ピッツァと手打ちパスタ", ink: "#273d2c", paper: "#edf0de", accent: "#546747" },
  "kanton-ryu": { genre: "広東料理", ink: "#672c38", paper: "#f8e9e4", accent: "#8a4150" },
} as const;

export function decorateRestaurant(config: ShopConfig, slug: keyof typeof shopDesigns, origin: string) {
  const { genre, ink, paper, accent } = shopDesigns[slug];
  config.header.imageUrl = `${origin}/s/${slug}/demo-photo.webp`;
  config.header.subtitle = config.description.split(" 予約体験用", 1)[0];
  config.appearance = {
    ...config.appearance!,
    theme: {
      ...standardTheme,
      headerHtml: `<header class="demo-header"><section class="demo-cover"><div class="demo-copy"><p class="demo-genre">大倉山の${genre}</p><slot name="title"></slot><slot name="subtitle"></slot><slot name="details"></slot><p class="demo-only">架空のデモ店舗</p></div><figure class="demo-figure"><slot name="image"></slot><figcaption>料理のイメージ</figcaption></figure></section><slot name="navigation"></slot></header>`,
      headerCss: `
        .demo-header { max-width: 76rem; margin: 0 auto; }
        .demo-cover { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1.3fr); color: ${ink}; background: ${paper}; overflow: hidden; border-radius: 1.3rem; }
        .demo-copy { display: flex; flex-direction: column; justify-content: center; padding: clamp(1.35rem,4vw,3.75rem); }
        .demo-copy h1 { margin: .18em 0 .38em; color: ${ink}; font: 700 clamp(2.2rem,4.9vw,4.2rem)/1.15 "Yu Mincho","Hiragino Mincho ProN",serif; letter-spacing: .035em; }
        .demo-copy p { line-height: 1.7; margin: .25em 0; }
        .demo-copy .demo-genre { color: ${accent}; font-weight: 750; letter-spacing: .09em; }
        .demo-copy .demo-only { margin-top: 1.2rem; color: ${ink}; font-size: .77rem; }
        .demo-copy .salon-details { margin-top: 1.05rem; }
        .demo-figure { position: relative; margin: 0; min-height: 22rem; }
        .demo-figure .salon-image { display: block; position: absolute; inset: 0; width: 100%; height: 100%; max-width: none; object-fit: cover; border-radius: 0; }
        .demo-figure figcaption { position: absolute; right: .8rem; bottom: .65rem; padding: .15rem .45rem; background: #251d18; color: #fff; border-radius: .18rem; font-size: .68rem; }
        @media (max-width: 680px) {
          .demo-cover { grid-template-columns: 1fr; }
          .demo-figure { min-height: 0; aspect-ratio: 16 / 9; }
        }`,
    },
  };
}

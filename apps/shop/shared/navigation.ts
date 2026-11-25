import { reservationsEnabled } from "../server/domain.ts";
import { storefrontText } from "./storefront-copy.ts";
import type { ShopConfig } from "../server/domain.ts";
import { articleKinds } from "./article-features.ts";

export const storefrontScreenAvailable = (config: ShopConfig | null | undefined, pane: string) =>
  pane !== "reserve" && pane !== "mine" || !config || reservationsEnabled(config);

export const customerStartPane = (config: ShopConfig | null | undefined) =>
  storefrontScreenAvailable(config, "mine") ? "mine" : "contact";

/** Keep the same primary order on public HTML, authenticated screens and previews. */
export function primaryNavigationItems(config: ShopConfig) {
  return [
    { pane: "about", href: "/", label: storefrontText(config, "navAbout") },
    ...(reservationsEnabled(config) ? [{ pane: "reserve", href: config.industry === "restaurant" ? "/reserve" : "/?pane=reserve", label: storefrontText(config, "navReserve") }] : []),
    ...(config.industry === "restaurant" ? [] : [
    ...(storefrontScreenAvailable(config, "mine") ? [{ pane: "mine", href: "/?pane=mine", label: storefrontText(config, "navMine") }] : []),
    { pane: "contact", href: "/?pane=contact", label: storefrontText(config, "navContact") }]),
  ];
}

/** The menu supplied by the application to the theme's navigation slot. */
export function navigationItems(config: ShopConfig) {
  return [
    ...primaryNavigationItems(config),
    ...articleKinds(config).map(kind => ({ href: `/${kind}`, label: storefrontText(config, kind === "blogs" ? "navBlogs" : "navAnnouncements") })),
    ...config.pages.map(page => ({ href: `/pages/${page.slug}`, label: page.navigationLabel })),
  ];
}

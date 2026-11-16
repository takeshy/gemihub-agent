import React from "react";

export type ParentShop = { id: string; name: string; area: string; cuisine: string; pageUrl: string; address?: string; description?: string; networkUrl?: string; networkTool?: string; reservationEnabled?: boolean; reservationUrl?: string };
export type ParentScenario = {
  page: "admin" | "site";
  shops?: ParentShop[];
  cache?: Record<string, { status?: string; error?: string; fetchedAt?: string }>;
  user?: boolean;
  configured?: boolean;
  ai?: "managed" | "byok";
  open?: "add";
};

/** The translation check reads `name`/`title` in story files as explorer labels, so fixtures use this helper and `label`. */
export const parentShop = (id: string, shopName: string, rest: Omit<ParentShop, "id" | "name">): ParentShop => ({ id, name: shopName, ...rest });

/**
 * Shows the parent finder (site/) or its administration page (admin/) from their real files.
 * `.storybook/parent-frame/mock.js` loads the page and answers its API calls from the scenario.
 */
export function ParentFrame({ label, scenario }: { label: string; scenario: ParentScenario }) {
  return <>
    <h2 style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}>{label}</h2>
    <iframe title={label} src={`parent-frame/frame.html?c=${encodeURIComponent(JSON.stringify(scenario))}`} style={{ display: "block", width: "100%", height: "100vh", border: 0 }} />
  </>;
}

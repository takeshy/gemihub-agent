import React, { useEffect, useMemo, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ApiProvider, type ApiClient } from "../api";
import { FinderEditor, PreviewUrl } from "../../../../admin/editor/FinderEditor";

// The AI page editor of the parent finder (admin/editor), with fixture versions and proposals.
type Item = { id: string; at: string | null; summary: string[]; request?: string; baseRevision?: string; appliedAt?: string; imageIds?: string[] };
type Scenario = "published" | "proposals";

function capture() {
  const canvas = document.createElement("canvas"); canvas.width = 780; canvas.height = 520;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#f3f5f0"; context.fillRect(0, 0, 780, 520);
  context.fillStyle = "#28594b"; context.fillRect(0, 0, 780, 72);
  context.fillStyle = "#253d35"; context.font = "bold 34px sans-serif"; context.fillText("ぴったりのお店を、話しながら見つけよう。", 40, 170);
  context.fillStyle = "#ffffff"; context.fillRect(40, 220, 700, 240);
  return { mimeType: "image/png", data: canvas.toDataURL("image/png").split(",")[1] };
}

function createClient(scenario: Scenario): ApiClient {
  const published: Item = { id: "published-2", at: "2026-11-16T04:00:00.000Z", summary: ["見出しを明るい印象に変更"] };
  const first: Item = { id: "published-1", at: null, summary: ["最初のデザイン"] };
  let state = {
    revision: "2", configured: true, published, versions: [published, first], publicUrl: "parent-site/index.html",
    proposals: scenario === "proposals" ? [
      { id: "proposal-2", at: "2026-11-16T05:10:00.000Z", request: "登録店の見出しを「近くのお店」に変えて", summary: ["登録店の見出しを「近くのお店」に変更しました。"], baseRevision: "2" },
      { id: "proposal-1", at: "2026-11-16T05:00:00.000Z", request: "全体をもう少し明るい色にして", summary: ["背景とボタンの色を明るくしました。"], baseRevision: "2" },
    ] as Item[] : [] as Item[],
  };
  const client = async (path: string, data?: unknown) => {
    const input = (data || {}) as { request?: string; sourceId?: string };
    if (path === "/api/session") return { user: { email: "operator@example.com" }, configured: true };
    if (path === "/api/site") return state;
    if (path === "/api/site/capture") return capture();
    if (path === "/api/site/proposals") {
      const proposal: Item = { id: `proposal-${state.proposals.length + 3}`, at: "2026-11-16T05:20:00.000Z", request: input.request, summary: [`「${input.request}」に合わせて画面を変更しました。`], baseRevision: state.revision };
      state = { ...state, proposals: [proposal, ...state.proposals] };
      return { ...state, proposal };
    }
    if (path === "/api/site/publish") {
      const source = [...state.proposals, ...state.versions].find(item => item.id === input.sourceId) || state.published;
      const next: Item = { id: `published-${state.versions.length + 1}`, at: "2026-11-16T05:30:00.000Z", summary: source.summary };
      state = { ...state, revision: String(Number(state.revision) + 1), published: next, versions: [next, ...state.versions] };
      return { ...state, message: "お店さがしに反映しました。" };
    }
    // The image library of the request picker starts empty.
    if (/\/images$/.test(path) && data === undefined) return [];
    throw new Error("Storybookでは使えない操作です");
  };
  return client as ApiClient;
}

function PageEditor({ scenario }: { scenario: Scenario }) {
  const client = useMemo(() => createClient(scenario), [scenario]);
  // Saved versions are previewed from the finder's own HTML and styles, without its scripts,
  // like the script-free preview the administration server renders.
  const [preview, setPreview] = useState("");
  useEffect(() => {
    let url = "", alive = true;
    void fetch("parent-site/index.html").then(response => response.text()).then(html => {
      if (!alive) return;
      const page = html.replace(/<script\b[\s\S]*?<\/script>/g, "").replace("<head>", `<head><base href="${new URL("parent-site/", document.baseURI).href}">`);
      url = URL.createObjectURL(new Blob([page], { type: "text/html" })); setPreview(url);
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, []);
  return <ApiProvider value={client}><PreviewUrl.Provider value={() => preview || "about:blank"}><FinderEditor api={client} /></PreviewUrl.Provider></ApiProvider>;
}

const meta = {
  id: "parent-page-editor",
  title: "お店さがしの運営/ページ編集",
  component: PageEditor,
  parameters: { layout: "fullscreen" },
  render: args => <PageEditor key={args.scenario} {...args} />,
} satisfies Meta<typeof PageEditor>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Published: Story = { name: "公開中の内容", args: { scenario: "published" } };
export const Proposals: Story = { name: "変更案の履歴", args: { scenario: "proposals" } };

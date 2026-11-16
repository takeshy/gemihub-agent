import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ParentFrame, parentShop, type ParentShop } from "./ParentFrame";

// The administration page of the parent finder (admin/), with fixture shops and no server.
const shops: ParentShop[] = [
  parentShop("num05", "Num05", { area: "神奈川県横浜市港北区・大倉山公園", address: "〒222-0037 神奈川県横浜市港北区大倉山２丁目１０", cuisine: "ネイル・美容サービス", description: "気さくなネイルサロンです。", pageUrl: "https://nail.example/", reservationEnabled: false }),
  parentShop("akari", "炉端 灯", { area: "東京都新宿区", cuisine: "和食・炉端焼き", description: "炭火の炉端焼きと日本酒のお店です。", pageUrl: "https://akari.example/reserve", networkUrl: "https://akari.example/agent/reservation_concierge", networkTool: "akari_reservation_concierge" }),
  parentShop("komado", "文具と器 こまど", { area: "東京都台東区", cuisine: "雑貨・生活雑貨", description: "作家の器と文具をそろえています。", pageUrl: "https://komado.example/" }),
];
const cache = {
  num05: { status: "connected", fetchedAt: "2026-11-16T09:00:00.000Z" },
  akari: { status: "connected", fetchedAt: "2026-11-16T09:00:00.000Z" },
  komado: { status: "error", error: "店のページを読み込めませんでした。", fetchedAt: "2026-11-15T09:00:00.000Z" },
};

const meta = {
  id: "parent-admin",
  title: "お店さがしの運営/管理画面",
  component: ParentFrame,
  parameters: { layout: "fullscreen" },
  args: { label: "お店さがしの管理画面" },
  render: args => <ParentFrame key={JSON.stringify(args.scenario)} {...args} />,
} satisfies Meta<typeof ParentFrame>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SignedOut: Story = { name: "ログイン前", args: { scenario: { page: "admin", user: false } } };
export const NotConfigured: Story = { name: "ログイン未設定", args: { scenario: { page: "admin", user: false, configured: false } } };
export const Empty: Story = { name: "登録店なし", args: { scenario: { page: "admin" } } };
export const Shops: Story = { name: "登録店あり", args: { scenario: { page: "admin", shops, cache } } };
export const AddShop: Story = { name: "店を追加", args: { scenario: { page: "admin", shops, cache, open: "add" } } };

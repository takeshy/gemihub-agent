import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ParentFrame, parentShop, type ParentShop } from "./ParentFrame";

// The public parent finder (site/), with fixture shops. Chat answers are fixed; no AI is contacted.
const shops: ParentShop[] = [
  parentShop("akari", "炉端 灯", { area: "東京都新宿区", cuisine: "和食・炉端焼き", pageUrl: "https://akari.example/reserve", networkUrl: "https://akari.example/agent/reservation_concierge", networkTool: "akari_reservation_concierge" }),
  parentShop("sole", "トラットリア ソーレ", { area: "東京都渋谷区", cuisine: "イタリアン・イタリア料理", pageUrl: "https://sole.example/reserve", networkUrl: "https://sole.example/agent/reservation_concierge", networkTool: "sole_reservation_concierge" }),
  parentShop("komado", "文具と器 こまど", { area: "東京都台東区", cuisine: "雑貨・生活雑貨", pageUrl: "https://komado.example/", reservationEnabled: false }),
  parentShop("num05", "Num05", { area: "神奈川県横浜市港北区・大倉山公園", cuisine: "ネイル・美容サービス", pageUrl: "https://nail.example/", reservationEnabled: false }),
];
// An address makes the page load the embedded Google map, so only the map story has one.
const withAddress = shops.map(shop => shop.id === "num05" ? { ...shop, address: "〒222-0037 神奈川県横浜市港北区大倉山２丁目１０" } : shop);

const meta = {
  id: "parent-finder",
  title: "お店さがし/トップページ",
  component: ParentFrame,
  parameters: { layout: "fullscreen" },
  args: { label: "お店さがし" },
  render: args => <ParentFrame key={JSON.stringify(args.scenario)} {...args} />,
} satisfies Meta<typeof ParentFrame>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Shops: Story = { name: "登録店あり", args: { scenario: { page: "site", shops } } };
export const Empty: Story = { name: "登録店なし", args: { scenario: { page: "site" } } };
export const Map: Story = { name: "地図でお店を確認", args: { scenario: { page: "site", shops: withAddress } } };
export const OwnKey: Story = { name: "自分のAPIキーを使う", args: { scenario: { page: "site", shops, ai: "byok" } } };

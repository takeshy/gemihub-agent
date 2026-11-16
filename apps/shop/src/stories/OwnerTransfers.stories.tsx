import React from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Screen } from "./Screen";
import { within, userEvent } from "storybook/test";
import { tr } from "../../shared/i18n";

const meta = {
  title: "運営/予約・お客様/キャンセル枠の予約",
  // The booking list opens on today's date, and these sample bookings are on later days.
  play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole("button", { name: tr("絞り込みを解除") })); },
  component: Screen,
  parameters: { layout: "fullscreen" },
  render: args => <Screen key={args.scenario} {...args} />,
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Listed: Story = { name: "キャンセル受付中の予約の管理", args: { scenario: "owner-transfer-listed" } };
export const Sold: Story = { name: "キャンセル枠から入った予約と履歴", args: { scenario: "owner-transfer-sold" } };
export const Refund: Story = { name: "元の予約者への返金・残高不足と再確認", args: { scenario: "owner-transfer-refund" } };

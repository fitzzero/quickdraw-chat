import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QuickStart } from "./QuickStart";

const meta = {
  title: "Landing/QuickStart",
  component: QuickStart,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof QuickStart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

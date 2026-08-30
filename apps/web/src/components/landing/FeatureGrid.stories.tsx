import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FeatureGrid } from "./FeatureGrid";

const meta = {
  title: "Landing/FeatureGrid",
  component: FeatureGrid,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FeatureGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

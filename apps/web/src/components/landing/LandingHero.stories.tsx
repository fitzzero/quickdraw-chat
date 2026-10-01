import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { LandingHero } from "./LandingHero";

const meta = {
  title: "Landing/LandingHero",
  component: LandingHero,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LandingHero>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

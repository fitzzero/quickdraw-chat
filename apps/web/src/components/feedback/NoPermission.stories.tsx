import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NoPermission } from "./NoPermission";

const meta = {
  title: "Feedback/NoPermission",
  component: NoPermission,
} satisfies Meta<typeof NoPermission>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomMessage: Story = {
  args: { message: "Only chat admins can change member roles." },
};

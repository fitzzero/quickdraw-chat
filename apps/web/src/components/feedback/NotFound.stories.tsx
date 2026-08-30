import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NotFound } from "./NotFound";

const meta = {
  title: "Feedback/NotFound",
  component: NotFound,
} satisfies Meta<typeof NotFound>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomBackLink: Story = {
  args: {
    message: "This chat no longer exists or you were removed from it.",
    backHref: "/chats",
    backLabel: "Back to chats",
  },
};

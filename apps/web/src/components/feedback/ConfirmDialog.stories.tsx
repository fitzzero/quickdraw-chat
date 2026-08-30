import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { ConfirmDialog } from "./ConfirmDialog";

const meta = {
  title: "Feedback/ConfirmDialog",
  component: ConfirmDialog,
  args: {
    open: true,
    onClose: fn(),
    onConfirm: fn(),
    title: "Leave this chat?",
    message: "You will stop receiving messages from this chat. You can be invited back later.",
  },
} satisfies Meta<typeof ConfirmDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Destructive: Story = {
  args: {
    title: "Delete this chat?",
    message: "This permanently deletes the chat and its messages for every member.",
    confirmLabel: "Delete",
    destructive: true,
  },
};

export const Loading: Story = {
  args: { isLoading: true },
};

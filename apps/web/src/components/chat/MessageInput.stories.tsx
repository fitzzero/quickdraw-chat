import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { MessageInput } from "./MessageInput";

const meta = {
  title: "Chat/MessageInput",
  component: MessageInput,
  // Sending is the chat window's (its postMessage shows the message as
  // sending); the input only hands the text over
  args: { onSend: fn() },
} satisfies Meta<typeof MessageInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Sending: Story = {
  args: { sending: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

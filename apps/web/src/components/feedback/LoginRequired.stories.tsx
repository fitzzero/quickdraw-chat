import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { LoginRequired } from "./LoginRequired";

const meta = {
  title: "Feedback/LoginRequired",
  component: LoginRequired,
} satisfies Meta<typeof LoginRequired>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const CustomMessage: Story = {
  args: { message: "Sign in to join this chat and see its history." },
};

import type { Meta, StoryObj } from "@storybook/nextjs-vite";
// quickdraw-migrate: review [v4-api] "@fitzzero/quickdraw-core/client/testing" was removed in 5.0; lint's no-v4-api names what replaces it
import { mockSuccessEmit } from "@fitzzero/quickdraw-core/client/testing";
import { withMockSocket } from "../../stories/decorators";
import { MessageInput } from "./MessageInput";

const meta = {
  title: "Chat/MessageInput",
  component: MessageInput,
  decorators: [withMockSocket],
  args: { chatId: "chat-1" },
  parameters: {
    // postMessage acks success; the collection delivers the message in the app
    mockSocket: { emit: mockSuccessEmit({ id: "msg-new" }) },
  },
} satisfies Meta<typeof MessageInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Disabled: Story = {
  args: { disabled: true },
};

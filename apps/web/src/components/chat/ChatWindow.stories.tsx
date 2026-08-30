import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { MessageDTO } from "@project/shared";
import { mockSuccessEmit } from "@fitzzero/quickdraw-core/client/testing";
import { withMockSocket } from "../../stories/decorators";
import type { MockEmitHandler } from "../../stories/mock-socket-io";
import { ChatWindow } from "./ChatWindow";

const ME = { id: "user-ada", name: "Ada Lovelace", image: null };
const OTHER = { id: "user-grace", name: "Grace Hopper", image: null };

const MESSAGES: MessageDTO[] = [
  {
    id: "msg-1",
    chatId: "chat-1",
    userId: OTHER.id,
    content: "The new collection subscriptions are live on dev.",
    role: "user",
    createdAt: "2026-08-30T09:00:00.000Z",
    user: OTHER,
  },
  {
    id: "msg-2",
    chatId: "chat-1",
    userId: ME.id,
    content: "Great — reconnect re-snapshots are working in my test too.",
    role: "user",
    createdAt: "2026-08-30T09:02:00.000Z",
    user: ME,
  },
  {
    id: "msg-3",
    chatId: "chat-1",
    userId: OTHER.id,
    content: "Shipping it.",
    role: "user",
    createdAt: "2026-08-30T09:03:00.000Z",
    user: OTHER,
  },
];

/** Answers the byChat collection subscribe with a message snapshot. */
function chatEmit(items: MessageDTO[]): MockEmitHandler {
  return (event, _payload, callback) => {
    if (event === "messageService:collection:subscribe") {
      mockSuccessEmit({
        items,
        rev: 1,
        totalCount: items.length,
        nextCursor: null,
      })(event, _payload, callback);
    }
    // Other emits (unsubscribes, postMessage) need no story response
  };
}

const meta = {
  title: "Chat/ChatWindow",
  component: ChatWindow,
  decorators: [
    withMockSocket,
    (Story) => (
      <Box sx={{ height: 520, display: "flex", flexDirection: "column" }}>
        <Story />
      </Box>
    ),
  ],
  args: { chatId: "chat-1" },
  parameters: {
    mockSocket: { userId: ME.id, emit: chatEmit(MESSAGES) },
  },
} satisfies Meta<typeof ChatWindow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const EmptyChat: Story = {
  parameters: {
    mockSocket: { userId: ME.id, emit: chatEmit([]) },
  },
};

export const NoChatSelected: Story = {
  args: { chatId: "" },
  parameters: { mockSocket: { userId: ME.id } },
};

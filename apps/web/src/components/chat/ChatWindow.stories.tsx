import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { MessageDTO } from "@project/shared";
import { qd, STORY_USER_ID } from "../../stories/quickdraw";
import { ChatWindow } from "./ChatWindow";

const ME = { id: STORY_USER_ID, name: "Ada Lovelace", image: null };
const OTHER = { id: "user-grace", name: "Grace Hopper", image: null };

function message(id: number, user: typeof ME, content: string, createdAt: string): MessageDTO {
  return {
    id: `msg-${String(id)}`,
    chatId: "chat-1",
    userId: user.id,
    content,
    role: "user",
    createdAt,
    user,
  };
}

// byChat's order: newest first (the window shows them oldest first)
const MESSAGES: MessageDTO[] = [
  message(3, OTHER, "Shipping it.", "2026-08-30T09:03:00.000Z"),
  message(
    2,
    ME,
    "Great — reconnect re-snapshots are working in my test too.",
    "2026-08-30T09:02:00.000Z",
  ),
  message(
    1,
    OTHER,
    "The new collection subscriptions are live on dev.",
    "2026-08-30T09:00:00.000Z",
  ),
];

const meta = {
  title: "Chat/ChatWindow",
  component: ChatWindow,
  decorators: [
    (Story) => (
      <Box sx={{ height: 520, display: "flex", flexDirection: "column" }}>
        <Story />
      </Box>
    ),
  ],
  args: { chatId: "chat-1" },
  // What the byChat collection shows for each story's chat (scopes no story
  // sets stay loading). A message sent here stays on its way (postMessage's
  // stub never answers), and the mock shows no optimistic adds: MessageList's
  // Sending and NotSent stories show those states.
  beforeEach: () => {
    qd.messageService.byChat.mockScope("chat-1", MESSAGES);
    qd.messageService.byChat.mockScope("chat-empty", []);
    qd.messageService.byChat.mockScope("chat-history", MESSAGES, {
      totalCount: 120,
      hasMore: true,
    });
  },
} satisfies Meta<typeof ChatWindow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const EmptyChat: Story = {
  args: { chatId: "chat-empty" },
};

export const WithOlderHistory: Story = {
  args: { chatId: "chat-history" },
};

export const Loading: Story = {
  args: { chatId: "chat-loading" },
};

export const Disconnected: Story = {
  parameters: { quickdraw: { session: { isConnected: false, isKnown: false } } },
};

export const NoChatSelected: Story = {
  args: { chatId: "" },
};

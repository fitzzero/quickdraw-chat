import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { MessageDTO } from "@project/shared";
import { fn } from "storybook/test";
import { MessageList } from "./MessageList";

const USERS = {
  ada: { id: "user-ada", name: "Ada Lovelace", image: null },
  grace: { id: "user-grace", name: "Grace Hopper", image: null },
} as const;

function message(
  id: number,
  user: (typeof USERS)[keyof typeof USERS],
  content: string,
  minutesAgo: number,
): MessageDTO {
  return {
    id: `msg-${id}`,
    chatId: "chat-1",
    userId: user.id,
    content,
    role: "user",
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    user,
  };
}

const CONVERSATION: MessageDTO[] = [
  message(1, USERS.ada, "Morning! Did the deploy go out?", 42),
  message(2, USERS.grace, "It did — dev is on the new build.", 40),
  message(3, USERS.ada, "Nice. The collection reconnect fix looks good in staging.", 38),
  message(4, USERS.grace, "Agreed. I'll write up the release notes after lunch.", 35),
  message(5, USERS.ada, "Perfect, thanks!", 34),
];

const meta = {
  title: "Chat/MessageList",
  component: MessageList,
  args: {
    messages: CONVERSATION,
    isLoading: false,
    currentUserId: USERS.ada.id,
    onLoadOlder: fn(),
  },
  decorators: [
    // The list fills a flex column in the app; give it a bounded frame here
    (Story) => (
      <Box sx={{ height: 480, display: "flex", flexDirection: "column" }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof MessageList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: { messages: [] },
};

export const Loading: Story = {
  args: { messages: [], isLoading: true },
};

export const WithOlderHistory: Story = {
  args: { hasMore: true },
};

export const LoadingOlder: Story = {
  args: { hasMore: true, isLoadingMore: true },
};

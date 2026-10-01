import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { HighScoreEntry } from "@project/shared";
import { fn } from "storybook/test";
import { PreGameDialog } from "./PreGameDialog";

const TOP_SCORES: HighScoreEntry[] = [
  { userId: "user-ada", name: "Ada", image: null, isGuest: false, bestLength: 148 },
  { userId: "user-grace", name: "Grace", image: null, isGuest: false, bestLength: 122 },
  { userId: "guest-1", name: "Speedy", image: null, isGuest: true, bestLength: 97 },
  { userId: "user-alan", name: "Alan", image: null, isGuest: false, bestLength: 85 },
  { userId: "guest-2", name: "Noodle", image: null, isGuest: true, bestLength: 64 },
];

const meta = {
  title: "Game/PreGameDialog",
  component: PreGameDialog,
  parameters: { layout: "fullscreen" },
  args: {
    mode: "start",
    topScores: TOP_SCORES,
    canStart: true,
    starting: false,
    needsGuest: false,
    bestLength: 122,
    onStart: fn(),
    onLogin: fn(),
  },
  decorators: [
    // The dialog is an absolute overlay above the game canvas
    (Story) => (
      <Box sx={{ position: "relative", height: "100vh", bgcolor: "background.default" }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof PreGameDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Start: Story = {};

export const GuestFlow: Story = {
  args: { needsGuest: true, bestLength: undefined },
};

export const AfterDeath: Story = {
  args: { mode: "dead", lastRunLength: 87 },
};

export const EngineLoading: Story = {
  args: { canStart: false },
};

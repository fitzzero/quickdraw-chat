import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { GameLoading } from "./GameLoading";

const meta = {
  title: "Game/GameLoading",
  component: GameLoading,
  parameters: { layout: "fullscreen" },
  args: {
    state: { phase: "loading", progress: 0.45 },
  },
  decorators: [
    // The overlay is absolutely positioned above the game canvas
    (Story) => (
      <Box sx={{ position: "relative", height: "100vh" }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof GameLoading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DownloadingEngine: Story = {};

export const IndeterminateDownload: Story = {
  args: { state: { phase: "loading", progress: null } },
};

export const Connecting: Story = {
  args: { state: { phase: "connecting" } },
};

export const EngineError: Story = {
  args: {
    state: { phase: "error", message: "Failed to load the game engine. Check your connection." },
  },
};

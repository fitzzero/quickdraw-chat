import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { SnakeTrailsCanvas } from "./SnakeTrailsCanvas";

const meta = {
  title: "Landing/SnakeTrailsCanvas",
  component: SnakeTrailsCanvas,
  parameters: { layout: "fullscreen" },
  decorators: [
    // The canvas fills its nearest positioned ancestor
    (Story) => (
      <Box sx={{ position: "relative", height: "60vh", overflow: "hidden" }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof SnakeTrailsCanvas>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

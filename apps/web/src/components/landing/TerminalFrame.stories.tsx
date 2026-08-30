import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { TerminalFrame } from "./TerminalFrame";

const meta = {
  title: "Landing/TerminalFrame",
  component: TerminalFrame,
  args: {
    children: (
      <Box sx={{ p: 2.5, fontFamily: "var(--font-mono), monospace", fontSize: 14 }}>
        $ bun run dev
      </Box>
    ),
  },
} satisfies Meta<typeof TerminalFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

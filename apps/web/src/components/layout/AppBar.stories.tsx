import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { withLayoutProvider } from "../../stories/decorators";
import { AppBar } from "./AppBar";

const meta = {
  title: "Layout/AppBar",
  component: AppBar,
  parameters: {
    layout: "fullscreen",
    nextjs: { navigation: { pathname: "/chats" } },
  },
  decorators: [
    withLayoutProvider,
    // position: fixed — reserve the bar's height so docs previews don't collapse
    (Story) => (
      <Box sx={{ position: "relative", height: 80 }}>
        <Story />
      </Box>
    ),
  ],
} satisfies Meta<typeof AppBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const OnProfilePage: Story = {
  parameters: { nextjs: { navigation: { pathname: "/profile" } } },
};

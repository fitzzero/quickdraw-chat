import * as React from "react";
import { Box, List, ListItem, ListItemText, ListSubheader } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useRightSidebar } from "../../providers/LayoutProvider";
import { withLayoutProvider } from "../../stories/decorators";
import { RightSidebar } from "./RightSidebar";

/** Pages fill the sidebar via useRightSidebar; this stands in for a page. */
function DemoSidebarContent({ children }: { children: React.ReactNode }): React.ReactElement {
  useRightSidebar(
    <List dense subheader={<ListSubheader disableSticky>Members</ListSubheader>}>
      {["Ada Lovelace", "Grace Hopper", "Alan Turing"].map((name) => (
        <ListItem key={name}>
          <ListItemText primary={name} />
        </ListItem>
      ))}
    </List>,
  );
  return <Box sx={{ display: "contents" }}>{children}</Box>;
}

const meta = {
  title: "Layout/RightSidebar",
  component: RightSidebar,
  parameters: { layout: "fullscreen" },
  decorators: [
    withLayoutProvider,
    (Story) => (
      <DemoSidebarContent>
        <Box sx={{ display: "flex", justifyContent: "flex-end", height: "100vh" }}>
          <Story />
        </Box>
      </DemoSidebarContent>
    ),
  ],
} satisfies Meta<typeof RightSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

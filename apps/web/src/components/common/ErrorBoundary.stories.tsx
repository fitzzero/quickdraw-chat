import * as React from "react";
import { Alert } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ErrorBoundary } from "./ErrorBoundary";

function AlwaysThrows(): React.ReactElement {
  throw new Error("Storybook demo: this child component always throws on render.");
}

const meta = {
  title: "Common/ErrorBoundary",
  component: ErrorBoundary,
  // The boundary logs the caught error; that is the point of the story
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ErrorBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CaughtError: Story = {
  args: {
    children: <AlwaysThrows />,
  },
};

export const CustomFallback: Story = {
  args: {
    children: <AlwaysThrows />,
    fallback: <Alert severity="warning">Something went wrong in this section.</Alert>,
  },
};

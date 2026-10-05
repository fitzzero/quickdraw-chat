import { Paper } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { SignInOptions } from "./SignInOptions";

// What the login page shows for each answer of the API's GET /auth/providers
const meta = {
  title: "Auth/SignInOptions",
  component: SignInOptions,
  args: { onRetry: fn() },
  decorators: [
    // The login page's card
    (Story) => (
      <Paper elevation={3} sx={{ p: 4, maxWidth: 400, textAlign: "center" }}>
        <Story />
      </Paper>
    ),
  ],
} satisfies Meta<typeof SignInOptions>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every sign-in served: Google, Discord and, in development, the demo-user picker. */
export const Default: Story = {
  args: {
    providers: [
      { id: "google", name: "Google", kind: "oauth" },
      { id: "discord", name: "Discord", kind: "oauth" },
      { id: "mock", name: "Mock", kind: "mock" },
    ],
  },
};

/** One provider configured. */
export const OneProvider: Story = {
  args: { providers: [{ id: "google", name: "Google", kind: "oauth" }] },
};

/** An app's own OAuth provider, by the name it gives itself. */
export const OwnProvider: Story = {
  args: { providers: [{ id: "acme", name: "Acme ID", kind: "oauth" }] },
};

/** A hosted development instance without Google or Discord credentials: the demo user alone. */
export const DemoUserOnly: Story = {
  args: { providers: [{ id: "mock", name: "Mock", kind: "mock" }] },
};

/** While the API is asked. */
export const Loading: Story = {
  args: { providers: undefined },
};

/** The API serves nothing to sign in with. */
export const Empty: Story = {
  args: { providers: [] },
};

/** The API could not be asked: a retry, and no button that could answer 404. */
export const Failed: Story = {
  args: { failed: true },
};

/** Asking again after a failure. */
export const Retrying: Story = {
  args: { failed: true, retrying: true },
};

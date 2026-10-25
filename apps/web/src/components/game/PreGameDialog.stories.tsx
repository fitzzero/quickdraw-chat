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

/** The run ended in another snake's body: the dialog names it. */
export const AfterDeath: Story = {
  args: { mode: "dead", lastRunLength: 87, killedBy: { name: "Wormy", contact: "body" } },
};

/** Two heads met: the front of this one's head touched the other's head. */
export const AfterHeadOn: Story = {
  args: { mode: "dead", lastRunLength: 42, killedBy: { name: "Grace", contact: "head" } },
};

export const EngineLoading: Story = {
  args: { canStart: false },
};

/** A join the server refused: the dialog says why, and its button tries again. */
export const JoinRefused: Story = {
  args: { joinError: "Something went wrong. Try again." },
};

/** A signed-in player: host a party, or join one by its code. */
export const PartyChoices: Story = {
  args: { onHostParty: fn(), onJoinParty: fn(), onLeaveParty: fn() },
};

/** The page hosts a party: its code to share, and the way to end it. */
export const PartyHost: Story = {
  args: {
    party: { code: "K7QD", role: "host" },
    onHostParty: fn(),
    onJoinParty: fn(),
    onLeaveParty: fn(),
  },
};

/** The page joined a party by its code. */
export const PartyGuest: Story = {
  args: {
    party: { code: "K7QD", role: "guest" },
    onHostParty: fn(),
    onJoinParty: fn(),
    onLeaveParty: fn(),
  },
};

/** A code no open party has: the dialog says so. */
export const PartyCodeNotFound: Story = {
  args: {
    onHostParty: fn(),
    onJoinParty: fn(),
    onLeaveParty: fn(),
    partyError: "No open party has that code.",
  },
};

/** The party ended under the player: its host left. */
export const PartyEnded: Story = {
  args: { onHostParty: fn(), onJoinParty: fn(), onLeaveParty: fn(), partyEnded: "hostLeft" },
};

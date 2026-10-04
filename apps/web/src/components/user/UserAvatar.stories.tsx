import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QuickdrawError } from "@fitzzero/quickdraw-core";
import type { EntityOf } from "@fitzzero/quickdraw-core";
import type { userContract } from "@project/shared";
import { qd } from "../../stories/quickdraw";
import { UserAvatar } from "./UserAvatar";

const ADA: EntityOf<typeof userContract> = {
  id: "user-ada",
  email: "ada@example.com",
  name: "Ada Lovelace",
  image: null,
  serviceAccess: null,
  // ── quickdraw-game:start ──
  isGuest: false,
  // ── quickdraw-game:end ──
  createdAt: "2026-08-01T09:15:00.000Z",
  updatedAt: "2026-08-01T09:15:00.000Z",
};

const meta = {
  title: "User/UserAvatar",
  component: UserAvatar,
  args: { userId: ADA.id },
  // What useEntity shows for each story's user (an id nobody set stays loading)
  beforeEach: () => {
    qd.userService.useEntity.mockRow(ADA);
    qd.userService.useEntity.mockError(
      "user-hidden",
      new QuickdrawError("FORBIDDEN", "Access denied"),
    );
  },
} satisfies Meta<typeof UserAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Large: Story = {
  args: { size: 64 },
};

export const Loading: Story = {
  // Nobody set this row: the subscription never answers, the skeleton stays
  args: { userId: "user-loading" },
};

export const AccessDenied: Story = {
  // A refused row also renders the skeleton — the avatar never leaks errors
  args: { userId: "user-hidden" },
};

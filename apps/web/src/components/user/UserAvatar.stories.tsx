import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { UserDTO } from "@project/shared";
import { mockErrorEmit, mockSuccessEmit } from "@fitzzero/quickdraw-core/client/testing";
import { withMockSocket } from "../../stories/decorators";
import { UserAvatar } from "./UserAvatar";

const ADA: UserDTO = {
  id: "user-ada",
  email: "ada@example.com",
  name: "Ada Lovelace",
  image: null,
  serviceAccess: null,
};

const meta = {
  title: "User/UserAvatar",
  component: UserAvatar,
  decorators: [withMockSocket],
  args: { userId: ADA.id },
  parameters: {
    // useSubscription resolves via userService:batchSubscribe → { [id]: entity }
    mockSocket: { emit: mockSuccessEmit({ [ADA.id]: ADA }) },
  },
} satisfies Meta<typeof UserAvatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Large: Story = {
  args: { size: 64 },
};

export const Loading: Story = {
  // No emit handler: the subscribe never resolves and the skeleton persists
  parameters: { mockSocket: {} },
};

export const AccessDenied: Story = {
  // Error responses also render the skeleton — the avatar never leaks errors
  parameters: { mockSocket: { emit: mockErrorEmit("Access denied", 403) } },
};

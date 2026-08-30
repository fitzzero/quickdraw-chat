import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { withLayoutProvider } from "../../stories/decorators";
import { Breadcrumbs } from "./Breadcrumbs";

const meta = {
  title: "Layout/Breadcrumbs",
  component: Breadcrumbs,
  parameters: {
    nextjs: { navigation: { pathname: "/chats" } },
  },
  decorators: [withLayoutProvider],
} satisfies Meta<typeof Breadcrumbs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ChatsPage: Story = {};

export const AccountPage: Story = {
  parameters: { nextjs: { navigation: { pathname: "/profile/account" } } },
};

export const Home: Story = {
  parameters: { nextjs: { navigation: { pathname: "/" } } },
};

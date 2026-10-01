import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { FeedbackPanel } from "./FeedbackPanel";

const meta = {
  title: "Feedback/FeedbackPanel",
  component: FeedbackPanel,
  args: {
    icon: InfoOutlinedIcon,
    iconColor: "text.secondary",
    title: "Nothing here yet",
    message: "This is the shared panel behind LoginRequired, NoPermission, and NotFound.",
    actionHref: "/",
    actionLabel: "Go home",
  },
} satisfies Meta<typeof FeedbackPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ContainedAction: Story = {
  args: {
    icon: WarningAmberIcon,
    iconColor: "warning.main",
    title: "Session expired",
    message: "Sign in again to keep chatting.",
    actionLabel: "Sign in",
    actionVariant: "contained",
  },
};

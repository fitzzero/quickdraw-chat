import BoltIcon from "@mui/icons-material/Bolt";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { FeatureDialog } from "./FeatureDialog";
import { FEATURE_SNIPPETS } from "./featureSnippets";

const meta = {
  title: "Landing/FeatureDialog",
  component: FeatureDialog,
  args: {
    featureKey: "featRealtime",
    icon: BoltIcon,
    accent: "#7c4dff",
    snippet: FEATURE_SNIPPETS.featRealtime,
    onClose: fn(),
  },
} satisfies Meta<typeof FeatureDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Closed: Story = {
  args: { featureKey: null },
};

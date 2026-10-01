import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { CodeBlock } from "./CodeBlock";
import { TerminalFrame } from "./TerminalFrame";

const TS_SAMPLE = `// Live list: one hook, framework handles deltas + reconnect
const { items, loadMore } = useCollection<MessageDTO>(
  "messageService",
  "byChat",
  chatId,
  { compare: compareByCreatedAt },
);`;

const BASH_SAMPLE = `git clone https://github.com/fitzzero/quickdraw-chat my-app
cd my-app && docker-compose up -d
bun install && bun run db:migrate
bun run dev`;

const YAML_SAMPLE = `jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - run: bun run build # turbo caches per package`;

const JSON_SAMPLE = `{
  // envMode loose: tasks read what they need
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] }
  }
}`;

const meta = {
  title: "Landing/CodeBlock",
  component: CodeBlock,
  args: { code: TS_SAMPLE, language: "ts" },
  decorators: [
    (Story) => (
      <TerminalFrame>
        <Story />
      </TerminalFrame>
    ),
  ],
} satisfies Meta<typeof CodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Bash: Story = {
  args: { code: BASH_SAMPLE, language: "bash" },
};

export const Yaml: Story = {
  args: { code: YAML_SAMPLE, language: "yaml" },
};

export const Json: Story = {
  args: { code: JSON_SAMPLE, language: "json" },
};

import * as React from "react";
import { CssBaseline, ThemeProvider as MuiThemeProvider } from "@mui/material";
import type { Preview } from "@storybook/nextjs-vite";
import { IntlProvider } from "../src/providers/IntlProvider";
import { ToastProvider } from "../src/providers/ToastProvider";
import { qd, type QuickdrawStoryParameters } from "../src/stories/quickdraw";
import { theme } from "../src/theme";
import "../src/app/globals.css";

// Mounts MUI theme + intl + toasts directly. Deliberately NOT
// src/providers/ThemeProvider.tsx (useServerInsertedHTML is Next-runtime-only)
// and NOT src/providers/index.tsx (it mounts the real QuickdrawProvider).
// Components' `qd` is quickdraw's mock client (see main.ts), and the mock's
// own provider gives the real `useQuickdraw()` the story's session.
const preview: Preview = {
  decorators: [
    (Story, context) => {
      // Who the story renders as: its `parameters.quickdraw.session`, laid
      // over the mock's default (STORY_USER_ID, connected) for this story's
      // subtree alone, so the stories a docs page renders side by side each
      // show their own
      const parameters = context.parameters.quickdraw as QuickdrawStoryParameters | undefined;
      return (
        <MuiThemeProvider theme={theme}>
          <CssBaseline />
          <IntlProvider>
            <ToastProvider>
              <qd.$Provider session={parameters?.session}>
                <Story />
              </qd.$Provider>
            </ToastProvider>
          </IntlProvider>
        </MuiThemeProvider>
      );
    },
  ],
  parameters: {
    layout: "padded",
    nextjs: { appDirectory: true },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    // SB10 keys options by id; the pre-9 `values: [...]` array is ignored
    backgrounds: {
      default: "app",
      options: {
        app: { name: "App", value: theme.palette.background.default },
        paper: { name: "Paper", value: theme.palette.background.paper },
      },
    },
  },
  tags: ["autodocs"],
};

export default preview;

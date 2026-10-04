import * as React from "react";
import { CssBaseline, ThemeProvider as MuiThemeProvider } from "@mui/material";
import type { Preview } from "@storybook/nextjs-vite";
import { IntlProvider } from "../src/providers/IntlProvider";
import { ToastProvider } from "../src/providers/ToastProvider";
import { StorySessionProvider, type StorySession } from "../src/stories/quickdraw";
import { theme } from "../src/theme";
import "../src/app/globals.css";

// Mounts MUI theme + intl + toasts directly. Deliberately NOT
// src/providers/ThemeProvider.tsx (useServerInsertedHTML is Next-runtime-only)
// and NOT src/providers/index.tsx (it mounts the real QuickdrawProvider).
// Components' `qd` is quickdraw's mock client (see main.ts); the session
// provider gives `useQuickdraw()` the story's signed-in user, or the one a
// story names in `parameters.quickdraw.session`.
const preview: Preview = {
  decorators: [
    (Story, context) => (
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        <IntlProvider>
          <ToastProvider>
            <StorySessionProvider
              session={
                (context.parameters.quickdraw as { session?: StorySession } | undefined)?.session
              }
            >
              <Story />
            </StorySessionProvider>
          </ToastProvider>
        </IntlProvider>
      </MuiThemeProvider>
    ),
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

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
// own provider gives the real `useQuickdraw()` the mock's session.
const preview: Preview = {
  // Who each story renders as: its `parameters.quickdraw.session` over the
  // mock's default session (a story without one gets the default back)
  beforeEach: (context) => {
    const parameters = context.parameters.quickdraw as QuickdrawStoryParameters | undefined;
    qd.$session(parameters?.session ?? {});
  },
  decorators: [
    (Story) => (
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        <IntlProvider>
          <ToastProvider>
            <qd.$Provider>
              <Story />
            </qd.$Provider>
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

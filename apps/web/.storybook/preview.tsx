import * as React from "react";
import { CssBaseline, ThemeProvider as MuiThemeProvider } from "@mui/material";
import type { Preview } from "@storybook/nextjs-vite";
import { IntlProvider } from "../src/providers/IntlProvider";
import { ToastProvider } from "../src/providers/ToastProvider";
import { theme } from "../src/theme";
import "../src/app/globals.css";

// Mounts MUI theme + intl + toasts directly. Deliberately NOT
// src/providers/ThemeProvider.tsx (useServerInsertedHTML is Next-runtime-only)
// and NOT src/providers/index.tsx (it drags in the socket layer).
const preview: Preview = {
  decorators: [
    (Story) => (
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        <IntlProvider>
          <ToastProvider>
            <Story />
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
    backgrounds: {
      default: "app",
      values: [{ name: "app", value: theme.palette.background.default }],
    },
  },
  tags: ["autodocs"],
};

export default preview;

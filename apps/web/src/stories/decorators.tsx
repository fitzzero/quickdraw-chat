import * as React from "react";
import type { Decorator } from "@storybook/nextjs-vite";
import { LayoutProvider } from "../providers/LayoutProvider";

/**
 * Wraps a story in LayoutProvider for components that call useLayout()
 * (it throws outside the provider).
 */
export const withLayoutProvider: Decorator = (Story) => (
  <LayoutProvider>
    <Story />
  </LayoutProvider>
);

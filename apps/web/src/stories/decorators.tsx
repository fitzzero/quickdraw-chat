import * as React from "react";
import { createMockQueryClient, createTestWrapper } from "@fitzzero/quickdraw-core/client/testing";
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

/**
 * Wraps a story in a mocked quickdraw socket + query context so
 * socket-coupled components render without a server.
 *
 * Stories customize the socket via `parameters.socketContext`, typically
 * built with `createMockSocket` / `mockSuccessEmit` from
 * `@fitzzero/quickdraw-core/client/testing`.
 */
export const withMockSocket: Decorator = (Story, ctx) => {
  const Wrapper = createTestWrapper({
    socketContext: ctx.parameters.socketContext,
    queryClient: createMockQueryClient(),
  });
  return (
    <Wrapper>
      <Story />
    </Wrapper>
  );
};

import * as React from "react";
import { QuickdrawProvider } from "@fitzzero/quickdraw-core/client";
import type { Decorator } from "@storybook/nextjs-vite";
import { LayoutProvider } from "../providers/LayoutProvider";
import { setMockSocketBehavior, type MockSocketBehavior } from "./mock-socket-io";

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
 * Wraps a story in the REAL QuickdrawProvider running over the mock socket
 * (Storybook aliases `socket.io-client` to ./mock-socket-io.ts), so
 * useSubscription / useCollection / useService behave exactly as in the app.
 *
 * Configure responses per story:
 *
 * ```tsx
 * export const Default: Story = {
 *   parameters: {
 *     mockSocket: {
 *       userId: "user-1",
 *       emit: mockSuccessEmit({ "user-1": userFixture }),
 *     } satisfies MockSocketBehavior,
 *   },
 * };
 * ```
 *
 * `mockSuccessEmit` / `mockErrorEmit` come from
 * `@fitzzero/quickdraw-core/client/testing`; an event-aware handler
 * `(event, payload, callback) => ...` covers stories that answer different
 * emits differently. Omit `emit` to leave requests pending (loading states);
 * set `connected: false` for disconnected states.
 */
export const withMockSocket: Decorator = (Story, ctx) => {
  // Per-story URL: docs pages mount sibling stories concurrently, and the
  // shim resolves behavior by the URL io() receives
  const serverUrl = `http://storybook.invalid/${ctx.id}`;
  setMockSocketBehavior(serverUrl, ctx.parameters.mockSocket as MockSocketBehavior | undefined);
  return (
    // key forces a fresh provider (and mock socket) per story
    <QuickdrawProvider key={ctx.id} serverUrl={serverUrl} autoConnect>
      <Story />
    </QuickdrawProvider>
  );
};

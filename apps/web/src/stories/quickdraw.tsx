// Storybook's stand-in for src/lib/quickdraw.ts. `.storybook/main.ts` points
// every import of the app's client module at this file, so components render
// over `createMockClient` (no server, no socket) with the same names: `qd`,
// whose hooks show what each story sets, and `useQuickdraw`, which reads the
// story's session from the global decorator in `.storybook/preview.tsx`.
//
// A story sets what the hooks show in its `beforeEach`, on the mock's members:
//
//   qd.messageService.byChat.mockScope("chat-1", messages); // useCollection
//   qd.userService.useEntity.mockRow(user);                  // useEntity
//   qd.chatService.getChatMembers.mockResolvedValue(members); // useQuery
//
// The mock is one module for every story, and a docs page renders several
// stories at once: give each story its own ids (scopes, rows) so their data
// never meets. What nobody set stays loading; mutations stay pending.

import * as React from "react";
import { PROTOCOL_VERSION, QUICKDRAW_VERSION, type AccessLevel } from "@fitzzero/quickdraw-core";
import { createQuickdrawConnection, type QuickdrawStatus } from "@fitzzero/quickdraw-core/client";
import { createMockClient } from "@fitzzero/quickdraw-core/testing/client";
import { contracts } from "@project/shared";

/** The user stories render as, unless a story's session names another. */
export const STORY_USER_ID = "user-ada";

/** The typed client's shape with stubs: every component's `qd` in Storybook. */
export const qd = createMockClient(contracts, {
  userId: STORY_USER_ID,
  // Storybook has no test runner's afterEach: stories set their own data
  resetAfterEach: false,
});

/** Who a story renders as (`parameters.quickdraw.session`). */
export interface StorySession {
  /** The signed-in user; `null` renders the signed-out state. Default {@link STORY_USER_ID}. */
  readonly userId?: string | null;
  /** `false` renders the state before the server's hello (connecting). Default `true`. */
  readonly connected?: boolean;
  /** The user's service grants, as the hello gives them. Default none. */
  readonly serviceAccess?: Readonly<Record<string, AccessLevel>>;
}

// Never opened: useQuickdraw() hands it out, nothing in Storybook calls it
const idleConnection = createQuickdrawConnection({ url: "http://storybook.invalid" });

/** The connection state `useQuickdraw()` gives a story's components. */
function statusOf(session: StorySession = {}): QuickdrawStatus {
  const connected = session.connected !== false;
  const userId = session.userId === undefined ? STORY_USER_ID : session.userId;
  const serviceAccess = session.serviceAccess ?? {};
  return {
    connection: idleConnection,
    status: connected ? "connected" : "connecting",
    isConnected: connected,
    isKnown: connected,
    reconnecting: false,
    hello: connected
      ? {
          protocol: PROTOCOL_VERSION,
          server: QUICKDRAW_VERSION,
          serverId: "storybook",
          limits: {
            maxInFlightQueries: 8,
            maxQueuedQueries: 64,
            maxSubscribeIds: 100,
            callTimeoutMs: 30_000,
            subscriptions: { maxInFlight: 8, maxQueued: 256 },
          },
          features: [],
          userId,
          serviceAccess,
        }
      : null,
    userId: connected ? userId : null,
    serviceAccess: connected ? serviceAccess : null,
    refusal: null,
    isRateLimited: false,
  };
}

const SessionContext = React.createContext<QuickdrawStatus>(statusOf());

/** The global decorator's provider: the story's session, for `useQuickdraw()`. */
export function StorySessionProvider({
  session,
  children,
}: {
  session?: StorySession;
  children: React.ReactNode;
}): React.ReactElement {
  const value = React.useMemo(() => statusOf(session), [session]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

// quickdraw-5.0 finding: createMockClient covers the client's members but not useQuickdraw(), so the catalog fakes the connection state (a hello included) through the app's own module alias
/** `useQuickdraw()` in Storybook: the story's session. */
export function useQuickdraw(): QuickdrawStatus {
  return React.useContext(SessionContext);
}

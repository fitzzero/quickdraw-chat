// Storybook's stand-in for src/lib/quickdraw.ts. `.storybook/main.ts` points
// every import of the app's client module at this file, so components render
// over `createMockClient` (no server, no socket) with the same name, `qd`,
// whose hooks show what each story sets. The global decorator in
// `.storybook/preview.tsx` renders every story inside a `qd.$Provider` of
// its own, whose session is the story's `parameters.quickdraw.session` laid
// over the default (STORY_USER_ID, connected): the real `useQuickdraw()`
// reads it there, so stories side by side on a docs page each show theirs.
//
// A story sets what the hooks show in its `beforeEach`, on the mock's members:
//
//   qd.messageService.byChat.mockScope("chat-1", messages); // useCollection
//   qd.userService.useEntity.mockRow(user);                  // useEntity
//   qd.chatService.getChatMembers.mockResolvedValue(members); // its call: useQuery, useJoin
//
// What a story sets (rows, scopes, answers) is shared by every story, and a
// docs page renders several stories at once: give each story its own ids
// (scopes, rows) so their data never meets. What nobody set stays loading;
// mutations stay pending.

import { createMockClient, type MockSession } from "@fitzzero/quickdraw-core/testing/mock";
import { contracts } from "@project/shared";

/** The user stories render as, unless a story's session names another. */
export const STORY_USER_ID = "user-ada";

/** The typed client's shape with stubs: every component's `qd` in Storybook. */
export const qd = createMockClient(contracts, {
  userId: STORY_USER_ID,
  // Storybook has no test runner's afterEach: stories set their own data
  resetAfterEach: false,
});

/** A story's `parameters.quickdraw`. */
export interface QuickdrawStoryParameters {
  /**
   * Who the story renders as, over the default session (STORY_USER_ID,
   * connected, known, no grants): `{ userId: null }` is signed out,
   * `{ isConnected: false, isKnown: false }` the state before the server's
   * hello, `{ serviceAccess: { chatService: "Admin" } }` the user's grants.
   */
  readonly session?: MockSession;
}

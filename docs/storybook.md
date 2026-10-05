# Storybook — the component review surface

Storybook is the fast lane for reviewing UI: every component renders in
isolation with its states laid out, no sign-in or database required. It is one
of the template's two review surfaces:

| Surface                                                               | What it covers                                                | When to use it                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| **Storybook** (`bun run storybook`)                                   | Individual components: props, states, variants, accessibility | A change to one component or its states         |
| **Dev server e2e** (`bun run dev` + seeded demo users via mock OAuth) | Full flows: auth, live sockets, multi-user chat, presence     | A change to a journey that spans pages or users |

Agents reviewing a UI change should open the story first; only flows that need
a signed-in user or real sockets warrant driving the dev server with
Playwright.

## Running

```bash
bun run storybook        # dev server on http://localhost:6106 (0.0.0.0)
bun run build-storybook  # static build into apps/web/storybook-static/
STORYBOOK_PORT=7000 bun run storybook   # port override
```

Storybook starts on demand — it is not part of `bun run dev` or pod boot, so
environment start-up cost stays flat. The `0.0.0.0` binding makes the port
forwardable from containers and pods. CI runs `build-storybook` in the build
job, so a story that stops compiling fails the pipeline.

## Writing stories

- **Co-locate**: `src/components/<domain>/Foo.stories.tsx`, with
  `title: "<Domain>/Foo"` mirroring the folder. The sidebar then doubles as a
  map of the codebase, and carve-outs that delete a component folder delete
  its stories with it.
- **Export the Props type** from the component
  (`export interface FooProps { ... }`) — `satisfies Meta<typeof Foo>` and the
  autodocs prop tables depend on it.
- **First export is `Default`**, then state variants (`Loading`, `Empty`,
  `Disabled`, error states).
- **Translations**: components resolve their own copy from
  `src/messages/en.json` through the global intl decorator. Text args are
  realistic English strings — never raw translation keys.
- **Lint rules apply to stories**: no raw strings in `Typography`, `Button`,
  or `Tooltip` in support JSX; `sx` theme tokens over hex values.
- The docs page (`autodocs`) and the a11y panel come free — check the
  Accessibility tab when adding a story.

## Decorators

The global decorator in `apps/web/.storybook/preview.tsx` provides the MUI
theme, `CssBaseline`, intl, toasts, and the mock client's provider with the
story's quickdraw session (below). It deliberately does NOT use
`src/providers/ThemeProvider.tsx`
(Next-runtime-only) or `src/providers/index.tsx` (it mounts the real
`QuickdrawProvider`).

`src/stories/decorators.tsx` adds one opt-in decorator:

- `withLayoutProvider` — for components that call `useLayout()`.

Route-dependent components mock `next/navigation` per story via
`parameters: { nextjs: { navigation: { pathname: "/chats" } } }`.

## Mocking quickdraw

Components read server data through the app's typed client (`qd` from
`src/lib/quickdraw.ts`) and the connection through `useQuickdraw()` from
`@fitzzero/quickdraw-core/client`. In the Storybook bundle, `.storybook/main.ts`
points every import of the app's module at `src/stories/quickdraw.tsx`, whose
`qd` is `createMockClient(contracts)` from `@fitzzero/quickdraw-core/testing/mock`
(the typed client's shape, with stubs, and no socket or server; that entry
names no Testing Library, for the browser bundle). The global decorator
renders every story inside the mock's own provider, `qd.$Provider`, where the
real `useQuickdraw()` reads the mock's session. Stories import `qd` from
`src/stories/quickdraw.tsx` (typed as the mock) and set what the hooks show in
a `beforeEach`:

```tsx
import { qd } from "../../stories/quickdraw";

const meta = {
  title: "Chat/ChatWindow",
  component: ChatWindow,
  args: { chatId: "chat-1" },
  beforeEach: () => {
    // what useCollection shows for the scope, in the collection's order
    qd.messageService.byChat.mockScope("chat-1", messages);
    // what useEntity shows for a row; mockError(id, error) for a refusal
    qd.userService.useEntity.mockRow(user);
    // what a query answers; mutations stay pending unless answered
    qd.chatService.getChatMembers.mockResolvedValue(members);
  },
} satisfies Meta<typeof ChatWindow>;
```

- What a story does not set stays loading (a row, a scope, a query), and a
  mutation stays pending: an id nobody set is the `Loading` story.
- The mock is one module for every story, and a docs page renders several
  stories at once: give each story its own ids (scopes, rows) so their data
  never meets (see `ChatWindow.stories.tsx`, `UserAvatar.stories.tsx`).
- `parameters: { quickdraw: { session: { userId, serviceAccess, isConnected, isKnown } } }`
  sets who the story renders as (`userId: null` is signed out,
  `{ isConnected: false, isKnown: false }` the state before the server's
  hello); the default is `STORY_USER_ID`, connected, with no grants. The
  preview's `beforeEach` gives it to the mock (`qd.$session`), so a story
  without one gets the default back. The session is the mock's one: a docs
  page that renders stories with different sessions shows them all with the
  last one set.
- The mock shows no optimistic updates: `MessageList`'s `Sending` and
  `NotSent` stories show a send's states from props.

## Story tiers

- **Pure components** (feedback, landing, `MessageList`, `MessageInput`,
  `AdminTable`): props in, pixels out — global decorator only.
- **Layout components** (`AppBar`, `Breadcrumbs`, `RightSidebar`):
  `withLayoutProvider` + a mocked pathname.
- **Live components** (`UserAvatar`, `ChatWindow`): mock-client exemplars.
  Keep this tier to pattern-setting examples — exhaustive coverage belongs to
  tests (`apps/web/src/__tests__`, against the real server), not stories.

<!-- ── quickdraw-game:start ── -->

Game overlay components (`PreGameDialog`, `GameLoading`) story like any pure
component — their stories live in `components/game/` and are removed with the
game carve-out.

<!-- ── quickdraw-game:end ── -->

## Stripping Storybook from a fork

```bash
./scripts/init-fork.sh my-app --without-storybook
```

`scripts/strip-storybook.mjs` removes the config, every story file,
`src/stories/`, these docs, the scoped agent rule, the turbo tasks and
scripts, and the CI step — then verifies no references remain and deletes
itself. It can also run standalone: `node scripts/strip-storybook.mjs`.

<!-- ── quickdraw-game:start ── -->

It composes with the game carve-out: when both flags are passed, the game
strips first so its wholesale folder deletions cover the game stories.

<!-- ── quickdraw-game:end ── -->

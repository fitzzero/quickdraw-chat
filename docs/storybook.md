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
theme, `CssBaseline`, intl, and toasts. It deliberately does NOT use
`src/providers/ThemeProvider.tsx` (Next-runtime-only) or
`src/providers/index.tsx` (drags in the socket layer).

`src/stories/decorators.tsx` adds two opt-in decorators:

- `withLayoutProvider` — for components that call `useLayout()`.
- `withMockSocket` — for socket-coupled components (`useSubscription`,
  `useCollection`, `useService`).

Route-dependent components mock `next/navigation` per story via
`parameters: { nextjs: { navigation: { pathname: "/chats" } } }`.

## Mocking the socket layer

`withMockSocket` mounts the REAL `QuickdrawProvider` over a fake socket:
`.storybook/main.ts` aliases `socket.io-client` to
`src/stories/mock-socket-io.ts` in the Storybook bundle (and excludes the core
client from dep pre-bundling so the alias applies). Hooks therefore behave
exactly as in the app — subscription registry, batching, reconnect handling
included.

Stories configure responses through `parameters.mockSocket`:

```tsx
import { mockSuccessEmit } from "@fitzzero/quickdraw-core/client/testing";
import { withMockSocket } from "../../stories/decorators";

const meta = {
  title: "User/UserAvatar",
  component: UserAvatar,
  decorators: [withMockSocket],
  parameters: {
    // subscriptions resolve via <service>:batchSubscribe → { [id]: entity }
    mockSocket: { emit: mockSuccessEmit({ "user-1": userFixture }) },
  },
} satisfies Meta<typeof UserAvatar>;
```

- `mockSuccessEmit(data)` / `mockErrorEmit(error)` (from
  `@fitzzero/quickdraw-core/client/testing`) answer every emit the same way.
- An event-aware handler `(event, payload, callback) => ...` covers
  components that make several calls — see `ChatWindow.stories.tsx`, which
  answers the collection subscribe with a message snapshot.
- Omit `emit` to keep requests pending (loading states); set
  `connected: false` for disconnected states; set `userId` to control the
  signed-in user.

Why the alias exists: core 4.1's `createTestWrapper` provides a context object
that the client hooks never read, so it cannot back browser stories. When core
ships a fixed wrapper, the shim can be replaced.

## Story tiers

- **Pure components** (feedback, landing, `MessageList`, `AdminTable`): props
  in, pixels out — global decorator only.
- **Layout components** (`AppBar`, `Breadcrumbs`, `RightSidebar`):
  `withLayoutProvider` + a mocked pathname.
- **Socket components** (`UserAvatar`, `MessageInput`, `ChatWindow`):
  `withMockSocket` exemplars. Keep this tier to pattern-setting examples —
  exhaustive coverage belongs to tests, not stories.

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

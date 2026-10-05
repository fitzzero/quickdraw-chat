---
paths:
  - "apps/web/**/*"
---

# Client Patterns

The typed client (`useEntity`, `useCollection`, `useQuery`, `useMutation`,
events, channels, optimistic updates, `qd.invalidate`) is in the linked
`quickdraw-client.md`; component tests in `quickdraw-testing.md`. This is
how the web app uses it.

## The client and the provider

- `apps/web/src/lib/quickdraw.ts` exports the one client,
  `qd = createQuickdrawClient(contracts)`, keyed by service name:
  `qd.chatService.myChats.useCollection(userId)`,
  `qd.messageService.postMessage.useMutation()`. Components import `qd` from
  `../lib/quickdraw`, and the hooks that take no client (`useQuickdraw`,
  `useJoin`, `useAdminServices`, `adminOf`) and the auth helpers from
  `@fitzzero/quickdraw-core/client`.
  <!-- ── quickdraw-storybook:start ── -->
  Storybook's mock of that one module stands in for `qd`, and the mock's own
  provider (`qd.$Provider`) for the connection `useQuickdraw()` reads.
  <!-- ── quickdraw-storybook:end ── -->
- `apps/web/src/providers/index.tsx` mounts `QuickdrawProvider` with
  `client={qd}`, the API's URL and no `auth`: the session is the httpOnly
  cookie the handshake carries, and the server's hello names the user.
  <!-- ── quickdraw-game:start ── -->
  The Discord Activity route (`/discord`) mounts its own provider with a
  token, since the Discord iframe drops third-party cookies.
  <!-- ── quickdraw-game:end ── -->
- Server data never gets a wrapper hook in `src/hooks/` and is never copied
  into React state: read it from `qd.<service>.<member>` where it is shown.
  `src/hooks/` holds UI hooks only (`useFilteredNavigation`,
  `usePushNotifications`, `useErrorText`, ...).

## Patterns in this app

- **Live lists** are collections: the sidebar and `/chats` read
  `qd.chatService.myChats.useCollection(userId)` (one item per chat, the
  index holding the whole list), the chat window
  `qd.messageService.byChat.useCollection(chatId)` with `loadMore` for
  older messages.
- **One row, live**: `qd.<service>.useEntity(id)` (a chat's title, a user's
  profile, a document). Fields tiered in the contract (`email`,
  `serviceAccess`) are optional in its `data`: guard them.
- **A send shown at once**: the mutation's `optimistic` adds the row it
  creates with `cache.addItem(collection, scope, item, { onRefused: "keep" })`
  (give it the collection's `order` fields), and the list styles
  `useCollection().pending` as sending (`ChatWindow`: a message shows at
  once, then the server's row in its place). A refused one leaves the items
  for `useCollection().refused`, which the window shows last, each with its
  `error`, `retry()` (the same call again) and `dismiss()`: the client keeps
  them, never component state, so they outlive the window. The input waits
  while `pending` is not empty: a retry is pending too, which the
  mutation's own `isPending` never sees.
- **Query-shaped reads** (a join, an aggregate): `useQuery`; an event that
  carries the new result writes it into the query's cache with
  `qd.<service>.<query>.setData(input, result)`.
- **Rooms joined by a call**: `useJoin(qd.<service>.<method>, input, { enabled })`,
  which runs the call again on every connection (a new socket is in no app
  room), never an effect on `hello` or `isConnected`. The chat sidebar reads
  its roster this way: `getChatMembers` puts the socket in the chat's room,
  where `memberUpdate` carries each new roster; `onJoined` and the event both
  `setData` it, and the roster reads the query's cache (`enabled: false`).
  A refusal stands until the next connection: show the join's `error` with
  a button that calls its `retry()` (the same call, at once, on this
  socket), never toggle `enabled` to run it again.
  <!-- ── quickdraw-game:start ── -->
  The game page joins its world room (`watchWorld`) and its player
  (`joinGame`, while the user plays) this way; a refused `joinGame` keeps
  the pre-game dialog open with the reason, and its button retries.
  <!-- ── quickdraw-game:end ── -->
- **Who is signed in**: `useQuickdraw()` gives `userId`, `serviceAccess`
  (the grants), `isKnown` and `reconnecting`. `userId === null` is "signed
  out" only once `isKnown` (see `AuthGate`): gate on it before showing
  sign-in prompts. A reconnect keeps the user and the page (`reconnecting`
  shows a notice).
- **Admin screens** (`/admin`, `components/admin/`) are generic: the
  services come from `useAdminServices(qd)` (it asks only the services the
  hello's grants allow), and every table and form from the service's
  `adminMeta` through `adminOf(qd, key)` (one shape for every admin kit,
  typed by field name). The kit's rows are not live: a screen reads its list
  again after its own writes. The forms show the fields whose `showInForm`
  is not `false`; a user's grants (`showInForm: false` on the server) have
  their own editor (`UserServiceAccessEditor`, written through `adminUpdate`),
  shown for the field the kit marks `kind: "grants"`.
- **Sign-in and sign-out** go through the auth routes kit with the client's
  `signInUrl(provider, AUTH_ROUTES)`, `signOut(AUTH_ROUTES)` and
  `signOutEverywhere(AUTH_ROUTES)` (`AUTH_ROUTES` in `apps/web/src/lib/auth.ts`
  says where the API is); a sign-out that rejects left the session live.
  The login page offers the sign-ins the API lists in `GET /auth/providers`
  (`fetchSignInProviders` under a plain TanStack `useQuery`: no quickdraw
  method serves it), never ones a `NEXT_PUBLIC_*` flag names.
- **Errors** shown to people: `useErrorText()` maps a `QuickdrawError`'s
  code to a translated message.

## UI text and styling

- No raw strings in `Typography`, `Button` or a `Tooltip`'s `title`
  (lint-enforced): `useTranslations()` from next-intl with keys in
  `apps/web/src/messages/en.json`.
- MUI `sx` with theme tokens (`"text.primary"`, `"grey.800"`), never raw
  hex; the theme is `apps/web/src/theme/index.ts`.
  <!-- ── quickdraw-storybook:start ── -->
  A new component gets a story beside it (`storybook.md`).
  <!-- ── quickdraw-storybook:end ── -->

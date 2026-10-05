# React Native Port Path

How a native iOS/Android app would sit beside this web template, from the
2026-08 spike (on quickdraw 4.1), brought up to date for quickdraw 5.0.
**Verdict: very feasible.** The data layer (the contracts in
`@project/shared` and quickdraw's typed client) is runtime-agnostic; only
the view layer needs rewriting, and the genuinely portable surface (chat) is
~1,000 lines of MUI JSX. Landing and admin would not ship on mobile as-is.

<!-- ── quickdraw-game:start ── -->

Neither would the Godot canvas.

<!-- ── quickdraw-game:end ── -->

## What shares, what doesn't

Shares unmodified:

- `packages/shared` — the contracts and their Zod schemas, pure TS. Runs on
  Hermes.
- `@fitzzero/quickdraw-core/client` — `createQuickdrawClient`,
  `QuickdrawProvider` and every `qd.<service>.<member>` hook need no DOM
  (deps: `react`, `socket.io-client`, `@tanstack/react-query`). The web
  app's client is two lines (`apps/web/src/lib/quickdraw.ts`); a native app
  makes the same one from the same contracts, so web/mobile drift is a
  typecheck failure rather than a runtime bug.

Does not share:

- All MUI JSX (~50 files, `sx`-prop styling). Mostly flexbox → mechanical
  `<Box sx>` → `<View style>` translation; the theme tokens in
  `apps/web/src/theme/index.ts` lift cleanly.
- `next/navigation` (16 files) → Expo Router, near 1:1 mapping.
- `useIsMobile` (MUI-bound) → `useWindowDimensions`.
<!-- ── quickdraw-game:start ── -->
- The Godot web embed (see below).
<!-- ── quickdraw-game:end ── -->

## Auth: a token in the handshake

The server's `socketAuth` takes a session token in the handshake
(`auth.token`) as readily as the browser's httpOnly cookie, and the HTTP
transport and `requireSession` take it as a bearer header: a cookie-less
client is a first-class case.

<!-- ── quickdraw-game:start ── -->

The Discord Activity already does (its page and its Godot client send
`auth.token`): `DiscordActivityShell.tsx` is the closest reference
implementation.

<!-- ── quickdraw-game:end ── -->

An RN client follows three steps:

1. Obtain a session token. The auth routes kit's OAuth callback sets a
   cookie and redirects, so native OAuth needs a completion that answers
   the token instead: an app route on `issueSession`, as
   `apps/api/src/auth/discord-activity.ts` does, driven from
   `expo-auth-session` or an in-app browser.
   <!-- ── quickdraw-game:start ── -->
   For guests, `POST /auth/guest` already answers `{ userId, name, token }`
   (`guest({ createUser, token: true })`): the token is in the body
   precisely for cookie-less clients.
   <!-- ── quickdraw-game:end ── -->
2. Store it in `expo-secure-store`.
3. Pass it as the provider's `auth`:
   `<QuickdrawProvider client={qd} url={API_URL} auth={token} transports={["websocket"]}>`.
   Changing it reconnects; a hello naming another user empties the cache.

## Gotchas

- Sign-out is `POST /auth/logout` with the token as a bearer header, then
  drop the stored token (the web's `apps/web/src/lib/auth.ts` sends the
  cookie instead).
- Read the API's URL from your app config: the web's fallbacks read
  `NEXT_PUBLIC_*` variables, which only Next.js inlines.
- The one unverified assumption is Metro bundling
  `@fitzzero/quickdraw-core/client` cleanly. The half-day de-risk spike:
  scaffold Expo, install core and shared, connect to the dev API with a
  token, render one `useCollection` list. That proves the entire shared
  stack.

<!-- ── quickdraw-game:start ── -->

## The game on mobile

The 38MB WASM embed (`GodotCanvas.tsx`) is only the _web delivery_ of the
game — the Godot project (`apps/game/godot`) exports natively to
iOS/Android, and its netcode speaks quickdraw's protocol 5 directly with
token auth (`addons/quickdraw/quickdraw_client.gd`); it never depended on a
browser.

Options, best-first:

1. **`@borndotcom/react-native-godot`** (Born + Migeran, LibGodot-based):
   real native engine in an RN view, JS↔Godot bridge, production-proven.
   The `.gd` netcode carries over; hand the SecureStore token into
   `net.gd` the way the Discord Activity does. Verify its bundled Godot
   runtime matches our editor version (`.pck` compatibility).
2. **WebView on the hosted `/game` route** — zero maintenance but 38MB
   over cellular plus iOS WKWebView SharedArrayBuffer/audio-worklet
   quirks. Fallback, not plan.
3. **Ship chat-only first** — game code is already fenced
   (`quickdraw-game` markers + `scripts/strip-game.mjs`). Game _state_
   (join/leaderboard) flows over ordinary typed service methods, so a
   native leaderboard needs no engine at all.

<!-- ── quickdraw-game:end ── -->

## Recommended v1 scope

Expo (managed) + Expo Router, chat-only: OAuth sign-in, the chat list
(`qd.chatService.myChats.useCollection(userId)`), the chat window
(`qd.messageService.byChat.useCollection(chatId)` + `FlatList`), account.

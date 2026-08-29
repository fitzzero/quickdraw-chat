# React Native Port Path

Findings from the 2026-08 spike on maintaining a native iOS/Android app
alongside this web template. **Verdict: very feasible.** The data layer
(core client hooks, project hook wrappers, `@project/shared`) is
runtime-agnostic; only the view layer needs rewriting, and the genuinely
portable surface (chat) is ~1,000 lines of MUI JSX. Landing and admin would
not ship on mobile as-is.

<!-- ── quickdraw-game:start ── -->

Neither would the Godot canvas.

<!-- ── quickdraw-game:end ── -->

Requires `@fitzzero/quickdraw-core` **≥ 4.1.0** (non-DOM guard in
`useSubscription`, `transports` prop).

## What shares, what doesn't

Shares unmodified:

- `packages/shared` — pure TS (types, zod, room helpers). Runs on Hermes.
- `@fitzzero/quickdraw-core/client` — deps are only `react`,
  `socket.io-client`, `@tanstack/react-query`; every hook is pure React.
- `apps/web/src/hooks/` — the typed wrappers (`useMyChats`, `useService`,
  `useServiceQuery`, `useSubscription`, admin hooks) are UI-free. Only
  `useIsMobile` is MUI-bound (→ `useWindowDimensions` in RN). If a mobile
  app materializes, extract these to a `packages/client-core` both apps
  consume.

Does not share:

- All MUI JSX (~50 files, `sx`-prop styling). Mostly flexbox → mechanical
  `<Box sx>` → `<View style>` translation; the theme tokens in
  `apps/web/src/theme/index.ts` lift cleanly.
- `next/navigation` (16 files) → Expo Router, near 1:1 mapping.
<!-- ── quickdraw-game:start ── -->
- The Godot web embed (see below).
<!-- ── quickdraw-game:end ── -->

## Auth: token-in-handshake, already first-class

The server's auth contract is `handshake.auth.token = <session JWT>`, with
the httpOnly cookie as a browser convenience — the token wins when both are
present (`apps/api/src/auth/middleware.ts`). The cookie-less path is already
proven in production.

<!-- ── quickdraw-game:start ── -->

Three consumers use it: the Discord Activity, the Godot client, and the bench
bots. `DiscordActivityShell.tsx` is the closest reference implementation.

<!-- ── quickdraw-game:end ── -->

An RN client follows three steps:

1. Obtain a session JWT:
   - **Guest**: `POST /auth/guest` returns `{ userId, name, token }` — the
     token is in the body precisely for cookie-less clients.
   - **OAuth**: run the existing `/auth/<provider>` flow in
     `expo-auth-session` / an in-app browser. The current callback is
     cookie-and-redirect only, so native OAuth needs a token-returning
     completion added.
2. Store it in `expo-secure-store`.
3. Pass it to `<QuickdrawProvider serverUrl={...} authToken={token}
transports={["websocket"]} autoConnect>`.

## Gotchas (learned in the spike)

- **Don't import core's `Socket*` input components** (`SocketTextField`
  etc.) in RN — they render DOM `<input>`. The headless `useSocketInput`
  is fine.
- **Don't use core's `getAuthToken`/`setAuthToken`** in RN — they're
  `localStorage`-backed and silently no-op off-browser (SSR guards). Pass
  the token as a prop from SecureStore instead.
- Always pass `apiUrl` explicitly to core's `getOAuthUrl`/`logout` — their
  env fallback is Next-specific.
- The one unverified assumption is Metro bundling
  `@fitzzero/quickdraw-core/client` cleanly (its barrel re-exports the
  MUI-based inputs; they're inert unless rendered, but confirm). The
  half-day de-risk spike: scaffold Expo, install core + shared, connect to
  the dev API with a token, render one `useCollection` list. That proves
  the entire shared stack.

<!-- ── quickdraw-game:start ── -->

## The game on mobile

The 38MB WASM embed (`GodotCanvas.tsx`) is only the _web delivery_ of the
game — the Godot project (`apps/game/godot`) exports natively to
iOS/Android, and its netcode speaks Socket.IO directly with token auth
(`addons/quickdraw/quickdraw_client.gd`); it never depended on a browser.

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

Expo (managed) + Expo Router, chat-only: guest/OAuth sign-in, chat list
(`useMyChats`), chat window (`useCollection("messageService", "byChat")` +
`FlatList`), account. Shared `ServiceMethodsMap` types make web/mobile
drift a typecheck failure rather than a runtime bug.

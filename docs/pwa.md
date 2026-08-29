# PWA & Web Push

The template ships as an installable PWA with optional Web Push
notifications. Everything works with push disabled; setting the VAPID keys
turns the notification features on.

## What's included

| Piece                                                                 | Where                                                                          |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Web app manifest (`id`/`start_url`/`scope`, maskable icons)           | `apps/web/public/site.webmanifest`                                             |
| Service worker: installability, push, notification click, resubscribe | `apps/web/public/sw.js`                                                        |
| SW registration (API origin passed via query string)                  | `apps/web/src/hooks/useServiceWorker.ts` → called in `src/providers/index.tsx` |
| Apple/standalone metadata                                             | `apps/web/src/app/layout.tsx` (`appleWebApp`, `manifest`)                      |
| `sw.js` no-cache header (new versions roll out without hard refresh)  | `apps/web/next.config.mjs`                                                     |
| Push opt-in toggle + test-notification button                         | `apps/web/src/app/account/page.tsx` via `usePushNotifications`                 |
| `pushService`: `subscribePush` / `unsubscribePush` / `sendTestPush`   | `apps/api/src/services/push-subscription/index.ts`                             |
| REST `POST /api/push/resubscribe` (SW renewal — SWs have no socket)   | `apps/api/src/services/push-subscription/rest.ts`                              |
| New-message pushes to offline chat members                            | `MessageService.afterCreate` → `pushService.notifyNewMessage`                  |
| `PushSubscription` rows (endpoint-unique, pruned on 410/404)          | `packages/db/prisma/schema.prisma`                                             |

## Enabling push

1. Generate a VAPID keypair: `bunx web-push generate-vapid-keys`
2. Set in `.env.local` (see `env.example`): `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` you own), and
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (same value as the public key).
3. Restart `bun run dev`, sign in, and flip **Notifications** on the
   `/account` page — then use **Send test**.

Without the keys the API boots normally, `pushService` logs one line and
every send is a no-op; the account-page toggle stays disabled because the
client sees no `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.

In production the private key belongs in your secret store (GCP Secret
Manager for the Cloud Run deploy); the public key and subject are non-secret
(`apps/api/env.cloudrun.yaml`). The web build needs
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` at build time (Vercel env var).

## Design notes

- **Sends never block writes.** `notifyNewMessage` is fire-and-forget from
  `MessageService.afterCreate`; failures log and die there.
- **Online members are skipped.** The composition root passes
  `isUserOnline` (checks the user's socket room) so pushes only go to
  members with no live connection. The sender is always skipped.
- **Stale endpoints self-clean.** A 410/404 from the push service deletes
  the subscription row.
- **The transport is injectable** (`PushServiceOptions.transport`), which is
  how the integration tests capture deliveries without real push services —
  and how you'd swap in a different delivery channel.
- **Payload shape** is `PushNotificationPayload` in `@project/shared`
  (`{ title, body, url, tag }`); the service worker consumes exactly that.
  Push payload budgets are ~4kb — keep it small.
- **No offline caching**: the SW `fetch` handler is a deliberate
  pass-through (required for installability). Forks wanting offline support
  add their caching strategy there.
- Notifications `tag` is `chat-<id>`, so a newer message replaces the
  previous notification per chat instead of stacking.

## Fork notes

- All PWA/push files survive `./scripts/init-fork.sh --without-game`
  untouched; brand strings in `site.webmanifest` / `layout.tsx` are
  rewritten by the fork script like the rest of the app.
- Generate a **fresh** VAPID keypair per deployment — never reuse another
  deploy's keys.

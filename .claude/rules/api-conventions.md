---
paths:
  - "apps/api/**/*"
---

# API Conventions

- **All data operations** use Socket.IO via `BaseService.defineMethod()` — never add REST endpoints for data
- **REST only** for: OAuth flows (`apps/api/src/auth/`), health checks, inbound webhooks
- REST routers are factory functions (`createAuthRouter()` style); validate request payloads with `validateRequest()` from `apps/api/src/utils/validate-request.ts`
- Auth is cookie-based: OAuth completion sets the httpOnly session cookie and redirects without any token in the URL; the socket handshake carries the cookie (`withCredentials`), identity arrives via `auth:info`; REST endpoints use `requireAuth` from `apps/api/src/auth/rest-middleware.ts` (cookie-first, Bearer fallback)
- Rate limiting: OAuth routes are wrapped with `createAuthLimiter()`; new public REST surfaces get `createPublicApiLimiter()` / `createWebhookLimiter()` from `@fitzzero/quickdraw-core/server/express`
- New OAuth providers: mirror `auth/google.ts` — core provider + `issueOAuthState`/`validateOAuthState` + `completeOAuthLogin` from `auth/oauth-callback.ts`

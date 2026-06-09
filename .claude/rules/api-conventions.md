---
paths:
  - "apps/api/**/*"
---

# API Conventions

- **All data operations** use Socket.IO via `BaseService.defineMethod()` — never add REST endpoints for data
- **REST only** for: OAuth flows (`apps/api/src/auth/`), health checks, inbound webhooks
- REST routers are factory functions (`createAuthRouter()` style); validate request payloads with `validateRequest()` from `apps/api/src/utils/validate-request.ts`
- Auth: socket connections authenticate via `auth.token` or the session cookie (`authenticateSocket`); REST endpoints use `requireAuth` from `apps/api/src/auth/rest-middleware.ts`
- Rate limiting: OAuth routes are wrapped with `createAuthLimiter()`; new public REST surfaces get `createPublicApiLimiter()` / `createWebhookLimiter()` from `@fitzzero/quickdraw-core/server/express`
- New OAuth providers: mirror `auth/google.ts` — core provider + `issueOAuthState`/`validateOAuthState` + `completeOAuthLogin` from `auth/oauth-callback.ts`

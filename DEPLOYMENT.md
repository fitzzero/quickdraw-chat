# Deployment Guide

This guide covers deploying quickdraw-chat to production.

The recommended path is the **Deploy workflow** (`.github/workflows/deploy.yml`):
TruffleHog secret scan → Prisma migrations against your database → Docker image
to Artifact Registry → Cloud Run (API) → Vercel (Web). The workflow defaults to
hosted Postgres over a direct TCP URL; Cloud SQL needs the blocks marked
`Cloud SQL only` in `deploy.yml` re-enabled. Docker Compose self-hosting is
documented as an alternative.

## Table of Contents

- [Environment Variables](#environment-variables)
- [Option 1: Deploy Workflow — Cloud Run (API) + Vercel (Web)](#option-1-deploy-workflow)
- [Option 2: Docker Compose (self-hosted)](#option-2-docker-compose-self-hosted)
- [Database Setup](#database-setup)
- [Upgrading to quickdraw 5.0](#upgrading-to-quickdraw-50)
- [Health Checks](#health-checks)

---

## Environment Variables

### Required for Production

```bash
# Database
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Auth
JWT_SECRET=your-secure-random-secret-here  # 32+ characters: openssl rand -base64 32
CLIENT_URL=https://your-domain.com         # Frontend URL — CORS + sign-in returns depend on it
API_URL=https://api.your-domain.com        # The API's public URL: OAuth callbacks are {API_URL}/auth/{provider}/callback
ENCRYPTION_KEY=<64-char hex>               # Encrypts stored OAuth tokens at rest: openssl rand -hex 32 (any other shape refuses to boot)

# Server
NODE_ENV=production

# Client (must be prefixed with NEXT_PUBLIC_, set in Vercel)
NEXT_PUBLIC_API_URL=https://api.your-domain.com
```

> Production hard-blocks: the API **refuses to boot** if `ENABLE_DEV_CREDENTIALS`
> or `ENABLE_MOCK_OAUTH` is set to `true` with `NODE_ENV=production`. These are
> dev-only flags from `.env.infra` — never set them in production environments.

### Optional

```bash
# Database connection pool
DB_POOL_MAX=20  # Max connections (default: 20)
DB_POOL_MIN=5   # Min connections (default: 5)

# OAuth (if using: a provider with neither value is left out, and one with
# only its id or only its secret refuses to boot). Register
# {API_URL}/auth/google/callback and {API_URL}/auth/discord/callback with them.
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...

# CORS / cookies
EXTRA_ALLOWED_ORIGINS=https://staging.your-domain.com  # comma-separated
COOKIE_DOMAIN=.your-domain.com                          # cross-subdomain sessions

# Bootstrap admin: Admin on every service, once a sign-in provider verified
# the address for that user (see "Upgrading to quickdraw 5.0" below)
ADMIN_EMAILS=you@your-domain.com

# Logging
LOG_LEVEL=info  # debug, info, warn, error
```

---

## Option 1: Deploy Workflow

Deploy-on-merge is already live: every push to `main` runs the workflow. You
can also start it by hand from the Actions tab (`workflow_dispatch`), which is
what the inputs below are for. Deploys run from `main` only — `dev` is the
integration branch and has no deploy target.

### 0. Pick a database

Two supported shapes; the workflow defaults to **hosted Postgres**:

- **Hosted Postgres with a direct TCP URL** (Prisma Postgres, Neon, Supabase…):
  free tiers scale to zero, so an idle demo costs ~$0. Use the direct
  `postgres://…?sslmode=require` string (for Prisma Postgres, _not_ the
  `prisma+postgres://` Accelerate URL) as both the `DATABASE_URL` GCP secret
  and the `DATABASE_MIGRATE_URL` GitHub secret. No proxy, no extra flags.
- **Cloud SQL** (~$9+/mo, always-on): re-enable the three blocks marked
  `Cloud SQL only` in `deploy.yml` (`CLOUD_SQL_INSTANCE` env, the proxy step,
  `--set-cloudsql-instances`), create the instance below, and point
  `DATABASE_MIGRATE_URL` at `127.0.0.1:5432` (proxy).

### Cold starts

The API deploys with `--min-instances=0` (see `deploy.yml`), so an idle demo
costs ~$0 — and the first visitor after idle pays a ~5–15s Cloud Run cold
start (`--cpu-boost` softens it). The web UI owns this: after ~2.5s of
connecting it shows a "Warming up the server… (demo budget ☕)" hint
(`useSlowLoadHint` in `apps/web/src/hooks/`). To eliminate cold starts
entirely, set `--min-instances=1` in `deploy.yml` (~$10/mo for an always-warm
instance).

### 1. GCP setup

```bash
gcloud projects create <PROJECT_ID>            # or reuse one
gcloud services enable run.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com

# Artifact Registry repo (matches SERVICE_NAME in deploy.yml)
gcloud artifacts repositories create quickdraw-chat \
  --repository-format=docker --location=us-central1

# Cloud SQL only (PostgreSQL 16) — skip for hosted Postgres
gcloud services enable sqladmin.googleapis.com
gcloud sql instances create <INSTANCE_NAME> --database-version=POSTGRES_16 \
  --region=us-central1 --tier=db-f1-micro
gcloud sql databases create quickdraw_chat --instance=<INSTANCE_NAME>
```

Workload Identity Federation + deploy service account (no JSON keys;
`<PROJECT_NUMBER>` from `gcloud projects describe <PROJECT_ID>`):

```bash
gcloud iam workload-identity-pools create github --location=global
gcloud iam workload-identity-pools providers create-oidc github-oidc \
  --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='<OWNER>/<REPO>'"

gcloud iam service-accounts create <APP>-deploy
DEPLOY_SA="<APP>-deploy@<PROJECT_ID>.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/run.admin --condition=None
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/artifactregistry.writer --condition=None
# Cloud SQL only: also grant roles/cloudsql.client for the migrate proxy

# deploy SA may act as the runtime SA (default compute)
gcloud iam service-accounts add-iam-policy-binding \
  <PROJECT_NUMBER>-compute@developer.gserviceaccount.com \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/iam.serviceAccountUser

# GitHub OIDC may impersonate the deploy SA (this repo only)
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github/attribute.repository/<OWNER>/<REPO>"

# GCP_WORKLOAD_IDENTITY_PROVIDER GitHub secret value:
#   projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github/providers/github-oidc
```

Secrets (repeat per name in the deploy.yml header; grant the runtime SA read):

```bash
printf '%s' "<value>" | gcloud secrets create JWT_SECRET \
  --data-file=- --replication-policy=automatic
gcloud secrets add-iam-policy-binding JWT_SECRET \
  --member="serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor
```

### 2. Secrets

**GitHub Secrets** (listed in the header of `.github/workflows/deploy.yml`):
`GCP_PROJECT_ID`, `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`,
`DATABASE_MIGRATE_URL`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`.

**GCP Secret Manager** (consumed by Cloud Run): `DATABASE_URL`, `JWT_SECRET`,
`ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`.

### 3. Placeholders

- `.github/workflows/deploy.yml`: `SERVICE_NAME`, region (+ `CLOUD_SQL_INSTANCE` if using Cloud SQL)
- `apps/api/env.cloudrun.yaml`: `CLIENT_URL`, `API_URL` and `ADMIN_EMAILS`
  (+ optional `EXTRA_ALLOWED_ORIGINS`, `COOKIE_DOMAIN`). The file ships the
  template's own deploy (its domains and its admin): a fork replaces all
  three, or its sign-ins return to the template's site and its OAuth
  callbacks point at the template's API.

### 4. Vercel

- `bunx vercel link --yes --project <name>` once to create the project; org and
  project IDs land in `.vercel/project.json` (→ GitHub secrets).
- Set the project **Root Directory** to `apps/web` — dashboard
  (Settings → Build & Deployment) or API; the CLI cannot set it, and builds
  fail without it (`vercel.json` lives in `apps/web`).
- Set `NEXT_PUBLIC_API_URL` for Production to the API origin.
  **Do not create it as a "sensitive" env var** (some `vercel env add`
  versions default to sensitive): the deploy workflow builds via
  `vercel pull → vercel build`, and `pull` cannot decrypt sensitive values —
  the bundle silently gets `""` and sockets connect to the page's own origin.
  Verify with `vercel env pull`: the real value must appear.
- Create an API token (Account Settings → Tokens) for the `VERCEL_TOKEN`
  secret.

### 5. Deploy

Merge to `main` and the workflow runs itself. To deploy without a merge, start
the **Deploy** workflow from the Actions tab; its inputs let you run migrations
only, skip the scan, or deploy a single side.

### 6. Custom domains (recommended)

Serve web and API from the same parent domain (`app.example.com` +
`app-io.example.com`): the session cookie then stays same-site, which keeps
cookie auth working in Safari (the raw `vercel.app` ↔ `run.app` pairing is
cross-site).

- **Vercel**: add the domain to the project (dashboard/API), then
  CNAME `<web-sub>` → `cname.vercel-dns.com` (DNS-only if your DNS proxies).
- **Cloud Run**: verify the apex domain in
  [Search Console](https://search.google.com/search-console) with the same
  Google account as gcloud, then
  `gcloud beta run domain-mappings create --service=<APP>-api --domain=<api-domain> --region=us-central1`
  and CNAME `<api-sub>` → `ghs.googlehosted.com` (DNS-only). Managed cert
  takes ~15–60 min.
- Point `CLIENT_URL` and `API_URL` (`apps/api/env.cloudrun.yaml`; the OAuth
  redirect URIs are `{API_URL}/auth/{provider}/callback`) and
  `NEXT_PUBLIC_API_URL` (Vercel) at these domains, and register the redirect
  URIs in the Google/Discord consoles.

---

## Option 2: Docker Compose (self-hosted)

Both apps ship Dockerfiles (`apps/api/Dockerfile`, `apps/web/Dockerfile`,
multi-stage bun builds with health checks). A minimal production compose file
adds the two app services next to the existing postgres service in
`docker-compose.yml`:

```yaml
services:
  api:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    env_file: .env.production
    ports: ["4000:4000"]
    depends_on: [postgres]
  web:
    build: { context: ., dockerfile: apps/web/Dockerfile }
    environment:
      - NEXT_PUBLIC_API_URL=https://api.your-domain.com
    ports: ["3000:3000"]
```

```bash
# 1. Create .env.production with the variables above
# 2. Build and start
docker-compose up -d --build
# 3. Run migrations
docker-compose exec api bunx prisma migrate deploy
```

Put a reverse proxy (Caddy/nginx) with TLS in front; WebSockets need
`Upgrade`/`Connection` headers forwarded.

---

## Database Setup

Schema changes always go through migrations (`bun run db:migrate` in dev,
committed to `packages/db/prisma/migrations/` — CI fails on drift):

```bash
# Production: apply pending migrations (the deploy workflow does this)
cd packages/db && DATABASE_URL=... bunx prisma migrate deploy
```

Optionally seed demo data on a fresh non-production instance with
`bun run db:seed` (idempotent; creates the demo users the mock OAuth picker
uses in dev).

---

## Upgrading to quickdraw 5.0

The 5.0 migrations apply to a 4.x database as they are (the deploy workflow
runs them). What changes for the people who use it:

- **Everyone signs in once more**: sessions now name their row, so the
  migration ends every 4.x session.
- **Verified emails.** A user's email counts (links a second provider's
  sign-in, matches `ADMIN_EMAILS`) only once a sign-in provider verified
  it. Nothing in a 4.x database records that, and 4.x stored and linked
  addresses no provider had verified, so every existing user starts
  unverified (`users.email_verified = false`). Their next sign-in through a
  provider that reports the stored address as verified (Google; Discord when
  the address is verified there) marks it.
- **Bootstrap admins** (`ADMIN_EMAILS`) hold Admin only once their address
  is verified that way: until their first such sign-in after the upgrade,
  an `ADMIN_EMAILS` user gets the default grants only, and the Admin grants
  a 4.x bootstrap stored on their row do not apply (such a row may be one
  that claimed the address through an unverified sign-in). Grants given in
  the admin screens to other users are kept as they are.

What an operator does, once, with the list of `ADMIN_EMAILS`:

1. Check which provider accounts can sign in to each admin (4.x linked a
   sign-in to the user holding its address whether or not the provider
   verified it), and delete any that is not the admin's own:

   ```sql
   SELECT u.id AS user_id, u.email, a.id AS account_id, a.provider,
          a.provider_account_id, a.created_at
   FROM users u JOIN accounts a ON a.user_id = u.id
   WHERE lower(u.email) IN ('you@your-domain.com');
   -- DELETE FROM accounts WHERE id = '<account_id>';
   ```

2. Have each admin sign in with Google (or Discord, with the address
   verified there). The sign-in marks the address and the bootstrap gives
   Admin again. Should that sign-in be refused (the log says "its verified
   email is held by a user no provider verified it for"), the address
   belongs to a user someone signed in to with an unverified address: give
   that user another address, or delete it, then sign in again:

   ```sql
   UPDATE users SET email = id || '@unclaimed.local' WHERE id = '<user_id>';
   ```

The same refusal can meet any user who signs in with a second provider
before their first sign-in after the upgrade; signing in once with the
provider they used before marks their address and ends it.

---

## Health Checks

- API: `GET /health` → `{ "status": "ok", ... }` (used by the Dockerfile
  HEALTHCHECK and Cloud Run startup probe)
- Web: Next.js standalone server responds on `/`

Logs are JSON with GCP severity fields in production (`LOG_LEVEL` to tune),
so Cloud Logging picks them up natively.

# Deployment Guide

This guide covers deploying quickdraw-chat to production.

The recommended path is the **Deploy workflow** (`.github/workflows/deploy.yml`):
TruffleHog secret scan → Prisma migrations against Cloud SQL → Docker image to
Artifact Registry → Cloud Run (API) → Vercel (Web). Docker Compose self-hosting
is documented as an alternative.

## Table of Contents

- [Environment Variables](#environment-variables)
- [Option 1: Deploy Workflow — Cloud Run (API) + Vercel (Web)](#option-1-deploy-workflow)
- [Option 2: Docker Compose (self-hosted)](#option-2-docker-compose-self-hosted)
- [Database Setup](#database-setup)
- [Health Checks](#health-checks)

---

## Environment Variables

### Required for Production

```bash
# Database
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Auth
JWT_SECRET=your-secure-random-secret-here  # Generate with: openssl rand -base64 32
CLIENT_URL=https://your-domain.com         # Frontend URL — CORS + OAuth redirects depend on it

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
# At-rest encryption for stored OAuth tokens (recommended)
ENCRYPTION_KEY=<64-char hex>   # openssl rand -hex 32

# Database connection pool
DB_POOL_MAX=20  # Max connections (default: 20)
DB_POOL_MIN=5   # Min connections (default: 5)

# OAuth (if using)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://api.your-domain.com/auth/google/callback
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_REDIRECT_URI=https://api.your-domain.com/auth/discord/callback

# CORS / cookies
EXTRA_ALLOWED_ORIGINS=https://staging.your-domain.com  # comma-separated
COOKIE_DOMAIN=.your-domain.com                          # cross-subdomain sessions

# Bootstrap admin
ADMIN_EMAILS=you@your-domain.com

# Logging
LOG_LEVEL=info  # debug, info, warn, error
```

---

## Option 1: Deploy Workflow

One-time setup, then deploys are a `workflow_dispatch` away (or uncomment the
`push: branches: [main]` trigger for deploy-on-merge).

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

# Workload Identity Federation for GitHub Actions (no JSON keys)
# https://github.com/google-github-actions/auth#setup
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
- `apps/api/env.cloudrun.yaml`: `CLIENT_URL` (+ optional `EXTRA_ALLOWED_ORIGINS`, `COOKIE_DOMAIN`)

### 4. Vercel

Create the Vercel project once (`bunx vercel link` from the repo root —
`vercel.json` configures the Next.js build), set `NEXT_PUBLIC_API_URL` to the
Cloud Run URL in the Vercel dashboard, and grab the org/project IDs for the
GitHub secrets.

### 5. Deploy

Run the **Deploy** workflow from the Actions tab. Inputs let you run
migrations only, skip the scan, or deploy a single side.

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

## Health Checks

- API: `GET /health` → `{ "status": "ok", ... }` (used by the Dockerfile
  HEALTHCHECK and Cloud Run startup probe)
- Web: Next.js standalone server responds on `/`

Logs are JSON with GCP severity fields in production (`LOG_LEVEL` to tune),
so Cloud Logging picks them up natively.

# Deployment Patterns

## Quick Reference

See `DEPLOYMENT.md` for comprehensive deployment guides.

## Deployment Options

### Option 1: Vercel (Web) + GCP Cloud Run (API)
**Best for:** Serverless, automatic scaling, minimal ops

```bash
# API to Cloud Run
gcloud builds submit --tag gcr.io/PROJECT/quickdraw-api
gcloud run deploy quickdraw-api --image gcr.io/PROJECT/quickdraw-api

# Web to Vercel
vercel --prod
```

### Option 2: Docker Compose
**Best for:** Self-hosted, full control, single-server deployments

```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Option 3: PM2 on VPS
**Best for:** Traditional VPS (DigitalOcean, Linode, AWS EC2)

```bash
pnpm build
pm2 start pm2.config.js --env production
pm2 save
```

## Pre-Deployment Checklist

### Required Environment Variables

Production requires these variables to be set:
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Strong random secret (32+ chars)
- `CLIENT_URL` - Frontend domain for CORS
- `NEXT_PUBLIC_API_URL` - API endpoint for client

The API will **fail to start** if these are missing in production (enforced by `validateEnv()`).

### Security Checklist

- [ ] JWT_SECRET is strong random value (not default)
- [ ] DATABASE_URL uses SSL (`?sslmode=require`)
- [ ] CLIENT_URL matches actual frontend domain
- [ ] HTTPS enabled (via provider or Nginx)
- [ ] Firewall restricts database access
- [ ] Rate limiting enabled (default: 100 req/min)

### Build Verification

Before deploying, always run:

```bash
pnpm lint && pnpm typecheck && pnpm build
```

## Health Checks

All deployments include health check endpoint:

```bash
curl https://api.your-domain.com/health
# Expected: {"status":"ok","timestamp":"..."}
```

Configure load balancers to use `/health` endpoint.

## Database Migrations

**Development:**
```bash
pnpm db:push  # Direct schema sync
```

**Production:**
```bash
pnpm db:migrate  # Creates migration files for safety
```

## Monitoring Integration Points

### Server-Side
- **Automatic logging** - All service methods logged via ServiceRegistry middleware
- **Winston logger** - Structured JSON logs in production
- **Error tracking** - Add Sentry SDK to `apps/api/src/index.ts`

### Client-Side
- **Error boundary** - Already configured in `apps/web/src/app/layout.tsx`
- **Integration point** - Add Sentry/LogRocket in ErrorBoundary.componentDidCatch()

## Graceful Shutdown

Handled automatically by `createQuickdrawServer()`:
- Listens for SIGTERM/SIGINT
- Closes HTTP server
- Disconnects all Socket.io clients
- 10-second timeout before force exit

## Connection Pooling

Configured in `packages/db/src/index.ts`:
- Default: max=20, min=5 (suitable for Cloud Run/Lambda)
- Configurable via `DB_POOL_MAX` and `DB_POOL_MIN` env vars
- Adjust for VPS: max=50, min=10

## Common Issues

### Socket.io Connection Failures
- Ensure WebSocket support in reverse proxy (Nginx, ALB)
- Cloud Run: Set minimum 1 instance to avoid cold starts
- Verify CORS configuration matches frontend domain

### Database Connection Pool Exhausted
- Reduce pool size: `DB_POOL_MAX=10`
- Use connection pooler (PgBouncer)
- Check for connection leaks in custom queries

## Rollback Procedures

See `DEPLOYMENT.md` for platform-specific rollback instructions.

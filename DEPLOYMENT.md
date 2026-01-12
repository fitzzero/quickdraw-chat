# Deployment Guide

This guide covers deploying quickdraw-chat to production environments.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Deployment Options](#deployment-options)
  - [Option 1: Vercel (Web) + GCP Cloud Run (API)](#option-1-vercel-web--gcp-cloud-run-api)
  - [Option 2: Docker Compose](#option-2-docker-compose)
  - [Option 3: PM2 on VPS](#option-3-pm2-on-vps)
- [Database Setup](#database-setup)
- [Health Checks](#health-checks)
- [Monitoring](#monitoring)

---

## Prerequisites

- Node.js 20+ and pnpm 9.0.0
- PostgreSQL database (managed or self-hosted)
- Domain name (optional but recommended)
- SSL certificates (handled by hosting providers)

---

## Environment Variables

### Required for Production

```bash
# Database
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Auth
JWT_SECRET=your-secure-random-secret-here  # Generate with: openssl rand -base64 32
CLIENT_URL=https://your-domain.com         # Frontend URL for CORS

# Server
BACKEND_PORT=4000
NODE_ENV=production

# Client (must be prefixed with NEXT_PUBLIC_)
NEXT_PUBLIC_API_URL=https://api.your-domain.com
```

### Optional

```bash
# Database Connection Pool
DB_POOL_MAX=20  # Max connections (default: 20)
DB_POOL_MIN=5   # Min connections (default: 5)

# OAuth (if using)
DISCORD_CLIENT_ID=your-discord-client-id
DISCORD_CLIENT_SECRET=your-discord-secret
DISCORD_REDIRECT_URI=https://your-domain.com/auth/callback/discord

GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-secret
GOOGLE_REDIRECT_URI=https://your-domain.com/auth/callback/google

# Logging
LOG_LEVEL=info  # debug, info, warn, error
```

---

## Deployment Options

### Option 1: Vercel (Web) + GCP Cloud Run (API)

**Best for:** Serverless deployment with automatic scaling

#### Step 1: Deploy API to GCP Cloud Run

```bash
# 1. Install Google Cloud CLI
# https://cloud.google.com/sdk/docs/install

# 2. Authenticate
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# 3. Build and push Docker image
cd apps/api
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/quickdraw-api

# 4. Deploy to Cloud Run
gcloud run deploy quickdraw-api \
  --image gcr.io/YOUR_PROJECT_ID/quickdraw-api \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production" \
  --set-env-vars "DATABASE_URL=YOUR_DATABASE_URL" \
  --set-env-vars "JWT_SECRET=YOUR_JWT_SECRET" \
  --set-env-vars "CLIENT_URL=https://your-domain.com" \
  --min-instances 1 \
  --max-instances 10 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300

# 5. Note the service URL (e.g., https://quickdraw-api-xxx.run.app)
```

**Important:** Cloud Run requires WebSocket support. Ensure your service is configured with:
- HTTP/2 enabled (default)
- Minimum 1 instance to avoid cold starts for Socket.io connections

#### Step 2: Deploy Web to Vercel

```bash
# 1. Install Vercel CLI
npm install -g vercel

# 2. Login
vercel login

# 3. Deploy from project root
vercel

# 4. Set environment variables in Vercel dashboard
# - NEXT_PUBLIC_API_URL=https://quickdraw-api-xxx.run.app

# 5. Deploy to production
vercel --prod
```

**Vercel Configuration:**

Create `vercel.json` in project root:

```json
{
  "buildCommand": "pnpm build --filter=@project/web",
  "outputDirectory": "apps/web/.next",
  "installCommand": "pnpm install",
  "framework": "nextjs",
  "regions": ["iad1"]
}
```

---

### Option 2: Docker Compose

**Best for:** Self-hosted deployment with full control

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: quickdraw_chat
      POSTGRES_USER: quickdraw
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    ports:
      - "4000:4000"
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://quickdraw:${DB_PASSWORD}@postgres:5432/quickdraw_chat
      JWT_SECRET: ${JWT_SECRET}
      CLIENT_URL: ${CLIENT_URL}
    depends_on:
      - postgres
    restart: unless-stopped

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      args:
        NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL}
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
    depends_on:
      - api
    restart: unless-stopped

volumes:
  postgres_data:
```

Deploy:

```bash
# 1. Create .env.production file with your secrets
cp env.example .env.production
# Edit .env.production with production values

# 2. Build and start services
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d

# 3. Run database migrations
docker-compose exec api pnpm db:push

# 4. View logs
docker-compose logs -f
```

---

### Option 3: PM2 on VPS

**Best for:** Traditional VPS deployment (DigitalOcean, Linode, AWS EC2)

#### Prerequisites

```bash
# Install Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
npm install -g pnpm@9.0.0

# Install PM2
npm install -g pm2
```

#### Deployment Steps

```bash
# 1. Clone repository
git clone https://github.com/your-org/quickdraw-chat.git
cd quickdraw-chat

# 2. Install dependencies
pnpm install

# 3. Set up environment
cp env.example .env.local
# Edit .env.local with production values

# 4. Generate Prisma client
pnpm db:generate

# 5. Push database schema
pnpm db:push

# 6. Build applications
pnpm build

# 7. Start with PM2
pm2 start pm2.config.js --env production

# 8. Save PM2 configuration
pm2 save

# 9. Set up PM2 to start on boot
pm2 startup
# Follow the instructions printed by the command

# 10. View logs
pm2 logs

# 11. Monitor processes
pm2 monit
```

#### PM2 Management Commands

```bash
# Restart all
pm2 restart all

# Stop all
pm2 stop all

# View status
pm2 status

# View logs
pm2 logs quickdraw-api
pm2 logs quickdraw-web

# Reload (zero-downtime restart)
pm2 reload all
```

#### Nginx Reverse Proxy

Create `/etc/nginx/sites-available/quickdraw`:

```nginx
# API server
server {
    listen 80;
    server_name api.your-domain.com;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        
        # WebSocket support
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Increase timeouts for long-lived connections
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}

# Web server
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable and restart Nginx:

```bash
sudo ln -s /etc/nginx/sites-available/quickdraw /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Set up SSL with Let's Encrypt
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com -d api.your-domain.com
```

---

## Database Setup

### Managed PostgreSQL (Recommended)

**Providers:**
- **Neon** (serverless, free tier): https://neon.tech
- **Supabase** (includes auth): https://supabase.com
- **Railway** (simple setup): https://railway.app
- **AWS RDS** (enterprise): https://aws.amazon.com/rds/
- **Google Cloud SQL**: https://cloud.google.com/sql

### Self-Hosted PostgreSQL

```bash
# Install PostgreSQL
sudo apt-get install postgresql postgresql-contrib

# Create database and user
sudo -u postgres psql
CREATE DATABASE quickdraw_chat;
CREATE USER quickdraw WITH ENCRYPTED PASSWORD 'your-password';
GRANT ALL PRIVILEGES ON DATABASE quickdraw_chat TO quickdraw;
\q

# Configure connection pooling (optional)
sudo apt-get install pgbouncer
# Edit /etc/pgbouncer/pgbouncer.ini
```

### Database Migrations

```bash
# Development: Push schema changes
pnpm db:push

# Production: Use migrations for safety
pnpm db:migrate

# View migration status
pnpm prisma migrate status

# Create new migration
pnpm prisma migrate dev --name your_migration_name
```

---

## Health Checks

### API Health Check

```bash
curl https://api.your-domain.com/health
# Expected: {"status":"ok","timestamp":"2024-01-01T00:00:00.000Z"}
```

### Load Balancer Configuration

**GCP Cloud Run:** Health checks are automatic via `/health` endpoint

**AWS ALB:**
```
Health check path: /health
Healthy threshold: 2
Unhealthy threshold: 3
Timeout: 5 seconds
Interval: 30 seconds
```

**Docker:** Health checks are built into Dockerfiles

---

## Monitoring

### Recommended Tools

1. **Application Monitoring**
   - Sentry (error tracking): https://sentry.io
   - LogRocket (session replay): https://logrocket.com
   - New Relic (APM): https://newrelic.com

2. **Infrastructure Monitoring**
   - Datadog: https://www.datadoghq.com
   - Grafana + Prometheus: https://grafana.com
   - Cloud provider native tools (GCP Monitoring, AWS CloudWatch)

3. **Uptime Monitoring**
   - UptimeRobot: https://uptimerobot.com
   - Pingdom: https://www.pingdom.com

### Log Aggregation

**GCP Cloud Run:** Logs are automatically sent to Cloud Logging

**PM2:**
```bash
# Install PM2 log rotation
pm2 install pm2-logrotate

# Configure log rotation
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

**Docker:**
```yaml
# Add to docker-compose.yml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

---

## Security Checklist

- [ ] `JWT_SECRET` is a strong random value (32+ characters)
- [ ] `DATABASE_URL` uses SSL (`?sslmode=require`)
- [ ] `CLIENT_URL` is set to your actual domain (not localhost)
- [ ] Environment variables are not committed to git
- [ ] HTTPS is enabled (via Nginx, Vercel, or Cloud Run)
- [ ] Database has strong password and restricted access
- [ ] Rate limiting is enabled (default: 100 req/min per socket)
- [ ] CORS is configured to only allow your frontend domain
- [ ] Firewall rules restrict database access to application servers only

---

## Troubleshooting

### Socket.io Connection Issues

**Problem:** WebSocket connections fail

**Solution:**
- Ensure your reverse proxy supports WebSocket upgrades
- Check firewall rules allow WebSocket traffic
- Verify `CLIENT_URL` matches your frontend domain exactly
- For Cloud Run, ensure minimum 1 instance to avoid cold starts

### Database Connection Pool Exhausted

**Problem:** "Too many connections" error

**Solution:**
```bash
# Reduce pool size in .env
DB_POOL_MAX=10
DB_POOL_MIN=2

# Or use connection pooler (PgBouncer)
```

### Build Failures

**Problem:** Docker build fails or runs out of memory

**Solution:**
```bash
# Increase Docker memory limit
docker build --memory=4g -t quickdraw-api .

# Or use multi-stage builds (already configured)
```

---

## Rollback Procedure

### Vercel
```bash
# List deployments
vercel ls

# Rollback to previous deployment
vercel rollback [deployment-url]
```

### GCP Cloud Run
```bash
# List revisions
gcloud run revisions list --service quickdraw-api

# Rollback to previous revision
gcloud run services update-traffic quickdraw-api \
  --to-revisions REVISION_NAME=100
```

### PM2
```bash
# Stop current version
pm2 stop all

# Pull previous version
git checkout previous-tag

# Rebuild
pnpm build

# Restart
pm2 restart all
```

---

## Support

For issues or questions:
- GitHub Issues: https://github.com/your-org/quickdraw-chat/issues
- Documentation: https://github.com/fitzzero/quickdraw

# Multi-stage build for quickdraw-chat API
FROM node:20-alpine AS base

# Install bun (kept in sync with package.json "packageManager")
RUN npm install -g bun@1.3.10

# ============================================================================
# Pruner stage — carve out @project/api's dependency subtree with a pruned
# lockfile (turbo prune --docker). bun derives the workspace member set from
# the workspace globs, so installing with members missing (apps/web) fails
# --frozen-lockfile checks against the repo lockfile; the pruned lockfile
# only covers what this image needs.
# ============================================================================
FROM base AS pruner
WORKDIR /app
RUN npm install -g turbo@2.8.15
COPY . .
RUN turbo prune @project/api --docker

# ============================================================================
# Dependencies stage - install all dependencies (pruned member set)
# ============================================================================
FROM base AS deps
WORKDIR /app

# Pruned workspace manifests + pruned bun.lock
COPY --from=pruner /app/out/json/ ./

# --ignore-scripts: no husky/postinstall inside the image
RUN bun install --frozen-lockfile --ignore-scripts

# ============================================================================
# Builder stage - build the application
# ============================================================================
FROM base AS builder
WORKDIR /app

# node_modules + manifests from deps, then pruned source on top
COPY --from=deps /app/ ./
COPY --from=pruner /app/out/full/ ./
# Root tsconfig: package tsconfigs extend it and the prisma-client generator
# resolves it during db:generate (turbo prune doesn't carry root configs)
COPY tsconfig.json ./

# Generate Prisma client
RUN bun run --filter @project/db db:generate

# Build packages
RUN bun run --filter @project/shared build
RUN bun run --filter @project/db build
RUN bun run --filter @project/api build

# ============================================================================
# Production stage - minimal runtime image
# ============================================================================
FROM base AS runner
WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 quickdraw

# Pruned manifests + lockfile, then production-only install (frozen works
# because the pruned lockfile matches the pruned member set)
COPY --from=pruner /app/out/json/ ./
RUN bun install --production --frozen-lockfile --ignore-scripts

# Copy built application
COPY --from=builder --chown=quickdraw:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=quickdraw:nodejs /app/packages/db/dist ./packages/db/dist
COPY --from=builder --chown=quickdraw:nodejs /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder --chown=quickdraw:nodejs /app/packages/shared/dist ./packages/shared/dist

# Switch to non-root user
USER quickdraw

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "apps/api/dist/index.js"]

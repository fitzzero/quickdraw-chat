# Multi-stage build for quickdraw-chat API
FROM node:20-alpine AS base

# Install bun
RUN npm install -g bun@1.3.10

# ============================================================================
# Dependencies stage - install all dependencies
# ============================================================================
FROM base AS deps
WORKDIR /app

# Copy workspace configuration
COPY package.json bun.lock ./

# Copy package.json files for all workspaces
COPY apps/api/package.json ./apps/api/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies
RUN bun install --frozen-lockfile

# ============================================================================
# Builder stage - build the application
# ============================================================================
FROM base AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules

# Copy source code
COPY package.json bun.lock turbo.json ./
COPY apps/api ./apps/api
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared

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

# Copy built application
COPY --from=builder --chown=quickdraw:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=builder --chown=quickdraw:nodejs /app/apps/api/package.json ./apps/api/
COPY --from=builder --chown=quickdraw:nodejs /app/packages/db/dist ./packages/db/dist
COPY --from=builder --chown=quickdraw:nodejs /app/packages/db/prisma ./packages/db/prisma
COPY --from=builder --chown=quickdraw:nodejs /app/packages/db/package.json ./packages/db/
COPY --from=builder --chown=quickdraw:nodejs /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=quickdraw:nodejs /app/packages/shared/package.json ./packages/shared/
COPY --from=builder --chown=quickdraw:nodejs /app/package.json /app/bun.lock ./

# Install production dependencies only
RUN bun install --frozen-lockfile --production

# Switch to non-root user
USER quickdraw

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "apps/api/dist/index.js"]

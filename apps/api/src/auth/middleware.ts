import {
  SESSION_COOKIE,
  type QuickdrawIdentity,
  type QuickdrawSocket,
} from "@fitzzero/quickdraw-core/server";
import type { AccessLevel } from "@project/shared";
import type { PrismaClient } from "@project/db";
import { verifyJWT } from "./jwt.js";
import { logger } from "../utils/logger.js";

/**
 * Socket authentication in the shape of core 4.0's `createQuickdrawServer`
 * auth hooks: `authenticate` resolves a {@link QuickdrawIdentity} (who is
 * this?), `loadServiceAccess` resolves service-level permissions (what may
 * they do?). The production composition root (`src/index.ts`) runs them with
 * a small local middleware because it needs its own Express app for the
 * OAuth routes; the integration test server passes them straight to
 * `createQuickdrawServer` — same contract either way.
 */
export interface SocketAuthOptions {
  /** Prisma client to authenticate against (production client or testPrisma). */
  prisma: PrismaClient;
  /**
   * All registered service names — used by bootstrap admin promotion
   * (ADMIN_EMAILS) to grant Admin on every service.
   */
  getServiceNames?: () => string[];
}

export interface SocketAuth {
  authenticate: (
    socket: QuickdrawSocket,
    auth: Record<string, unknown>,
  ) => Promise<QuickdrawIdentity | undefined>;
  loadServiceAccess: (userId: string) => Promise<Record<string, AccessLevel> | null>;
}

/**
 * Parse ADMIN_EMAILS environment variable into a Set of lowercase emails.
 */
function getBootstrapAdminEmails(): Set<string> {
  const emailsEnv = process.env.ADMIN_EMAILS;
  if (!emailsEnv) return new Set();

  return new Set(
    emailsEnv
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );
}

/**
 * Parse SERVICE_DEFAULT_ACCESS environment variable into default service permissions.
 * Format: "serviceName:Level,serviceName:Level" (e.g., "userService:Read,chatService:Read")
 */
function getDefaultServiceAccess(): Record<string, AccessLevel> {
  const config = process.env.SERVICE_DEFAULT_ACCESS;
  if (!config) return {};

  const defaults: Record<string, AccessLevel> = {};
  for (const entry of config.split(",")) {
    const [service, level] = entry.trim().split(":");
    if (service && level && ["Public", "Read", "Moderate", "Admin"].includes(level)) {
      defaults[service] = level as AccessLevel;
    }
  }
  return defaults;
}

/**
 * Merge user's explicit serviceAccess with default service permissions.
 * Explicit user access takes precedence over defaults.
 */
function mergeWithDefaults(
  userAccess: Record<string, AccessLevel> | null,
): Record<string, AccessLevel> {
  const defaults = getDefaultServiceAccess();
  const explicit = userAccess ?? {};

  return { ...defaults, ...explicit };
}

/**
 * Check if a user should be auto-promoted to admin and update their serviceAccess.
 * For non-bootstrap admins, merges user's explicit access with SERVICE_DEFAULT_ACCESS.
 * Returns the final serviceAccess to use.
 */
async function checkAndApplyBootstrapAdmin(
  prisma: PrismaClient,
  userId: string,
  email: string | null,
  currentServiceAccess: Record<string, AccessLevel> | null,
  getServiceNames?: () => string[],
): Promise<Record<string, AccessLevel>> {
  const bootstrapEmails = getBootstrapAdminEmails();

  // If no bootstrap emails configured or user doesn't match, return merged access
  if (bootstrapEmails.size === 0 || !email || !bootstrapEmails.has(email.toLowerCase())) {
    return mergeWithDefaults(currentServiceAccess);
  }

  // User is in bootstrap admin list - grant admin to all services
  const serviceNames = getServiceNames?.() ?? [];
  if (serviceNames.length === 0) {
    logger.warn("Bootstrap admin: No services registered yet", { userId, email });
    return currentServiceAccess ?? {};
  }

  // Build full admin access for all services
  const fullAdmin: Record<string, AccessLevel> = {};
  for (const serviceName of serviceNames) {
    fullAdmin[serviceName] = "Admin";
  }

  // Check if user already has full admin access
  const hasFullAccess = serviceNames.every((name) => currentServiceAccess?.[name] === "Admin");

  if (hasFullAccess) {
    // Already has full admin, no update needed
    return currentServiceAccess ?? {};
  }

  // Update database with full admin access
  logger.info("Bootstrap admin: Granting admin access", {
    userId,
    email,
    services: serviceNames,
  });

  await prisma.user.update({
    where: { id: userId },
    data: { serviceAccess: fullAdmin },
  });

  return fullAdmin;
}

/**
 * Attempt dev-mode authentication using a direct userId from the handshake.
 * Returns the identity, or undefined if this path doesn't apply.
 */
async function tryDevAuth(
  prisma: PrismaClient,
  auth: Record<string, unknown>,
): Promise<QuickdrawIdentity | undefined> {
  if (process.env.ENABLE_DEV_CREDENTIALS !== "true") return undefined;
  // Hard-refuse dev credentials in production — even if the flag is set,
  // it must never authenticate arbitrary userIds on a public host.
  if (process.env.NODE_ENV === "production") {
    logger.error("ENABLE_DEV_CREDENTIALS is set in production — refusing to honor");
    return undefined;
  }
  if (typeof auth.userId !== "string") return undefined;

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { id: true },
  });

  if (!user) return undefined;

  logger.debug(`Dev auth: user ${user.id} connected`);
  return { userId: user.id, principalType: "user" };
}

/**
 * Extract a session cookie token from the handshake cookie header.
 */
function extractCookieToken(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return match ? match.slice(SESSION_COOKIE.length + 1) : undefined;
}

/**
 * Attempt JWT-based authentication using an explicit token or session cookie.
 * Returns the identity, or undefined for missing/invalid/revoked sessions
 * (the socket then connects anonymously).
 */
async function tryTokenAuth(
  prisma: PrismaClient,
  socket: QuickdrawSocket,
  auth: Record<string, unknown>,
): Promise<QuickdrawIdentity | undefined> {
  const cookieToken = extractCookieToken(socket.handshake.headers?.cookie);
  const token = typeof auth.token === "string" ? auth.token : cookieToken;
  if (!token) return undefined;

  const payload = await verifyJWT(token);
  if (!payload?.userId) return undefined;

  // Verify session exists and is not expired (enables token revocation).
  // A live session implies the user exists — sessions cascade-delete with
  // their user — so no separate user lookup is needed here.
  const session = await prisma.session.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) {
    logger.debug("Session not found or expired", { userId: payload.userId });
    return undefined;
  }

  return { userId: payload.userId, principalType: "user" };
}

/**
 * Build the `authenticate` / `loadServiceAccess` hook pair.
 *
 * `authenticate` supports:
 * - JWT token authentication via auth.token or session cookie
 * - Dev credentials (when ENABLE_DEV_CREDENTIALS=true, never in production)
 *
 * It deliberately returns identity only — `loadServiceAccess` owns
 * permissions (user record + SERVICE_DEFAULT_ACCESS merge + ADMIN_EMAILS
 * bootstrap promotion), so both hooks stay independently testable.
 *
 * Unauthenticated sockets connect anonymously — access checks happen
 * per-method, so no auth means no access rather than a rejected connection.
 */
export function createSocketAuth(options: SocketAuthOptions): SocketAuth {
  const { prisma, getServiceNames } = options;

  return {
    authenticate: async (socket, auth) => {
      const devIdentity = await tryDevAuth(prisma, auth);
      if (devIdentity) return devIdentity;

      return await tryTokenAuth(prisma, socket, auth);
    },

    loadServiceAccess: async (userId) => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, serviceAccess: true },
      });
      if (!user) return mergeWithDefaults(null);

      return checkAndApplyBootstrapAdmin(
        prisma,
        userId,
        user.email,
        user.serviceAccess as Record<string, AccessLevel> | null,
        getServiceNames,
      );
    },
  };
}

import type { QuickdrawSocket } from "@fitzzero/quickdraw-core/server";
import type { AccessLevel } from "@project/shared";
import { prisma } from "@project/db";
import { verifyJWT } from "./jwt.js";
import { logger } from "../utils/logger.js";

/**
 * Options for socket authentication.
 */
export interface AuthenticateSocketOptions {
  /**
   * Function to get all registered service names.
   * Used for bootstrap admin functionality.
   */
  getServiceNames?: () => string[];
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
      .filter((e) => e.length > 0)
  );
}

/**
 * Check if a user should be auto-promoted to admin and update their serviceAccess.
 * Returns the updated serviceAccess.
 */
async function checkAndApplyBootstrapAdmin(
  userId: string,
  email: string | null,
  currentServiceAccess: Record<string, AccessLevel> | null,
  getServiceNames?: () => string[]
): Promise<Record<string, AccessLevel>> {
  const bootstrapEmails = getBootstrapAdminEmails();

  // If no bootstrap emails configured or user doesn't match, return current access
  if (bootstrapEmails.size === 0 || !email || !bootstrapEmails.has(email.toLowerCase())) {
    return currentServiceAccess ?? {};
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
  const hasFullAccess = serviceNames.every(
    (name) => currentServiceAccess?.[name] === "Admin"
  );

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
 * Authenticate a socket connection.
 *
 * Supports:
 * - JWT token authentication (production)
 * - Dev credentials (when ENABLE_DEV_CREDENTIALS=true)
 * - Bootstrap admin auto-promotion (when email is in ADMIN_EMAILS)
 */
export async function authenticateSocket(
  socket: QuickdrawSocket,
  next: (err?: Error) => void,
  options?: AuthenticateSocketOptions
): Promise<void> {
  try {
    const auth = socket.handshake.auth as Record<string, unknown>;

    // Dev mode: accept userId directly
    if (process.env.ENABLE_DEV_CREDENTIALS === "true" && auth.userId) {
      const userId = String(auth.userId);
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, serviceAccess: true },
      });

      if (user) {
        socket.userId = user.id;
        socket.serviceAccess = await checkAndApplyBootstrapAdmin(
          user.id,
          user.email,
          user.serviceAccess as Record<string, AccessLevel> | null,
          options?.getServiceNames
        );
        logger.debug(`Dev auth: user ${userId} connected`);
        next();
        return;
      }
    }

    // Production: verify JWT token
    if (auth.token) {
      const token = String(auth.token);
      const payload = await verifyJWT(token);

      if (payload?.userId) {
        const user = await prisma.user.findUnique({
          where: { id: payload.userId },
          select: { id: true, email: true, serviceAccess: true },
        });

        if (user) {
          socket.userId = user.id;
          socket.serviceAccess = await checkAndApplyBootstrapAdmin(
            user.id,
            user.email,
            user.serviceAccess as Record<string, AccessLevel> | null,
            options?.getServiceNames
          );
          next();
          return;
        }
      }
    }

    // Allow anonymous connections (they just won't be able to do much)
    socket.userId = undefined;
    socket.serviceAccess = {};
    next();
  } catch (error) {
    logger.error("Socket authentication error:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    next(new Error("Authentication failed"));
  }
}

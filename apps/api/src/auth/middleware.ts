import type { QuickdrawSocket } from "../core/BaseService";
import type { AccessLevel } from "@project/shared";
import { prisma } from "@project/db";
import { verifyJWT, type JWTPayload } from "./jwt";
import { logger } from "../utils/logger";

/**
 * Authenticate a socket connection.
 *
 * Supports:
 * - JWT token authentication (production)
 * - Dev credentials (when ENABLE_DEV_CREDENTIALS=true)
 */
export async function authenticateSocket(
  socket: QuickdrawSocket,
  next: (err?: Error) => void
): Promise<void> {
  try {
    const auth = socket.handshake.auth as Record<string, unknown>;

    // Dev mode: accept userId directly
    if (process.env.ENABLE_DEV_CREDENTIALS === "true" && auth.userId) {
      const userId = String(auth.userId);
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, serviceAccess: true },
      });

      if (user) {
        socket.userId = user.id;
        socket.serviceAccess = (user.serviceAccess as Record<string, AccessLevel>) ?? {};
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
          select: { id: true, serviceAccess: true },
        });

        if (user) {
          socket.userId = user.id;
          socket.serviceAccess = (user.serviceAccess as Record<string, AccessLevel>) ?? {};
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

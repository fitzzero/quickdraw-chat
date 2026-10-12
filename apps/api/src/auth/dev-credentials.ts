// Development credentials: with ENABLE_DEV_CREDENTIALS=true under NODE_ENV
// development or test, a socket may sign in by naming a user in its handshake
// (`auth: { userId }`, no token), for a game editor and load-test bots.
// `socketAuth({ devCredentials })` serves the handshake and runs it under
// those two NODE_ENVs only; the API refuses to boot with the flag under any
// other (`index.ts`).

import type { PrismaClient } from "@project/db";
import { userPrincipal, type AppPrincipal } from "../quickdraw.js";
import { logger } from "../utils/logger.js";

/** `socketAuth`'s `devCredentials`: the principal of the user a development handshake names, or `null` (refused). */
export type DevCredentials = (userId: string) => Promise<AppPrincipal | null>;

/**
 * The development sign-in for `socketAuth`, or `undefined` (none) unless
 * ENABLE_DEV_CREDENTIALS=true under NODE_ENV development or test, the only
 * two quickdraw runs it under. An unknown user id is refused
 * (`UNAUTHENTICATED`), so a mistyped editor user fails loudly.
 */
export function devCredentials(prisma: PrismaClient): DevCredentials | undefined {
  if (process.env.ENABLE_DEV_CREDENTIALS !== "true") return undefined;
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === "production") {
    logger.error("ENABLE_DEV_CREDENTIALS is set in production — refusing to honor");
    return undefined;
  }
  if (nodeEnv !== "development" && nodeEnv !== "test") {
    logger.error(
      `ENABLE_DEV_CREDENTIALS needs NODE_ENV=development (NODE_ENV is ${nodeEnv ?? "unset"}) — refusing to honor`,
    );
    return undefined;
  }
  return async (userId) => {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return null;
    logger.debug(`Dev auth: user ${user.id} connected`);
    return userPrincipal(user.id);
  };
}

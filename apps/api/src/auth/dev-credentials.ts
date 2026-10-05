// Development credentials: with ENABLE_DEV_CREDENTIALS=true (never in
// production), a socket may sign in by naming a user in its handshake
// (`auth: { userId }`, no token), for a game editor and load-test bots.
// `socketAuth({ devCredentials })` serves the handshake and refuses it in
// production itself; the production boot refuses the flag too (`index.ts`).

import type { Principal } from "@fitzzero/quickdraw-core/server";
import type { PrismaClient } from "@project/db";
import { logger } from "../utils/logger.js";

/** `socketAuth`'s `devCredentials`: the principal of the user a development handshake names, or `null` (refused). */
export type DevCredentials = (userId: string) => Promise<Principal | null>;

/**
 * The development sign-in for `socketAuth`, or `undefined` (none) unless
 * ENABLE_DEV_CREDENTIALS=true outside production. An unknown user id is
 * refused (`UNAUTHENTICATED`), so a mistyped editor user fails loudly.
 */
export function devCredentials(prisma: PrismaClient): DevCredentials | undefined {
  if (process.env.ENABLE_DEV_CREDENTIALS !== "true") return undefined;
  if (process.env.NODE_ENV === "production") {
    logger.error("ENABLE_DEV_CREDENTIALS is set in production — refusing to honor");
    return undefined;
  }
  return async (userId) => {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return null;
    logger.debug(`Dev auth: user ${user.id} connected`);
    return { userId: user.id, kind: "user" };
  };
}

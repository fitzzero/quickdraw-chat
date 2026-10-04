// Development credentials: with ENABLE_DEV_CREDENTIALS=true (never in
// production), a socket may sign in by naming a user in its handshake
// (`auth: { userId }`), for the Godot editor and the netcode bench's bots.
// The production boot refuses the flag (`index.ts`), and this refuses it
// again at every handshake.

import type { Principal } from "@fitzzero/quickdraw-core/server";
import type { PrismaClient } from "@project/db";
import { logger } from "../utils/logger.js";

/**
 * The principal a development handshake names, or `null` when the flag is
 * off, in production, without a string `auth.userId`, or for an unknown user.
 */
export async function devCredentialsPrincipal(
  prisma: PrismaClient,
  auth: Readonly<Record<string, unknown>>,
): Promise<Principal | null> {
  if (process.env.ENABLE_DEV_CREDENTIALS !== "true") return null;
  if (process.env.NODE_ENV === "production") {
    logger.error("ENABLE_DEV_CREDENTIALS is set in production — refusing to honor");
    return null;
  }
  if (typeof auth.userId !== "string") return null;
  const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { id: true } });
  if (!user) return null;
  logger.debug(`Dev auth: user ${user.id} connected`);
  return { userId: user.id, kind: "user" };
}

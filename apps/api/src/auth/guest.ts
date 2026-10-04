/**
 * Guest sessions — anonymous play without loosening any auth invariant.
 *
 * Everything downstream (socket auth, channels, chat membership, scores)
 * requires a real userId, so instead of supporting anonymous sockets we
 * mint a real-but-guest User row + session cookie. The game's pre-game
 * dialog calls this before booting the Godot client for signed-out
 * visitors ("log in for persistent stats" upsells the real thing).
 *
 * The auth routes kit serves it (`POST /auth/guest`, rate-limited there):
 * this module is the app's half, `createUser`, which validates the name and
 * creates the guest.
 */

import { QuickdrawError } from "@fitzzero/quickdraw-core";
import { guest, type GuestProvider, type GuestUser } from "@fitzzero/quickdraw-core/server/auth";
import type { PrismaClient } from "@project/db";
import { z } from "zod";

const NAME_ATTEMPTS = 3;

const guestBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .regex(/^[\p{L}\p{N} _\-'.]+$/u, "Letters, numbers and basic punctuation only"),
});

/** Creates the guest user: its id, and the name it got (`"Ada#4821"` when "Ada" was taken). */
async function createGuestUser(prisma: PrismaClient, requestedName: string): Promise<GuestUser> {
  for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt++) {
    // User.name is unique — retry with a numeric tag on collision
    const name =
      attempt === 0 ? requestedName : `${requestedName}#${1000 + Math.floor(Math.random() * 9000)}`;
    try {
      const user = await prisma.user.create({
        data: { name, isGuest: true, email: `guest-${crypto.randomUUID()}@guest.local` },
        select: { id: true },
      });
      return { userId: user.id, name };
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }
  throw new QuickdrawError("CONFLICT", "name_taken");
}

/**
 * The guest sign-in: `POST /auth/guest` with `{ name }` creates a guest user
 * (written untracked: a new user has no subscribers) and signs it in.
 * Answers `{ userId, name, token }` (the name it got, and the session's
 * token for clients without a cookie jar, such as a native app) with the
 * session cookie; an invalid name is `VALIDATION`, a name taken after three
 * tries `CONFLICT`.
 */
export function guestProvider(prisma: PrismaClient): GuestProvider {
  return guest({
    token: true,
    createUser: async (input) => {
      const parsed = guestBodySchema.safeParse(input);
      if (!parsed.success) {
        throw new QuickdrawError("VALIDATION", "A guest needs a name of 1 to 24 letters or digits");
      }
      return await createGuestUser(prisma, parsed.data.name);
    },
  });
}

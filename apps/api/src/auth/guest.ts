/**
 * Guest sessions — anonymous play without loosening any auth invariant.
 *
 * Everything downstream (socket auth, channels, chat membership, scores)
 * requires a real userId, so instead of supporting anonymous sockets we
 * mint a real-but-guest User row + session cookie. The game's pre-game
 * dialog calls this before booting the Godot client for signed-out
 * visitors ("log in for persistent stats" upsells the real thing).
 *
 * REST (not a service method) because it must run before any
 * authenticated socket can exist. Rate-limited at the mount site.
 */

import type { Express, Request, Response } from "express";
import { setSessionCookie } from "@fitzzero/quickdraw-core/server";
import { prisma as defaultPrisma, type PrismaClient } from "@project/db";
import { logger } from "../utils/logger.js";
import { validateRequest, z } from "../utils/validate-request.js";
import { createJWT } from "./jwt.js";

const SESSION_EXPIRY_DAYS = 7;
const NAME_ATTEMPTS = 3;

const guestBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .regex(/^[\p{L}\p{N} _\-'.]+$/u, "Letters, numbers and basic punctuation only"),
});

export interface GuestAuthDeps {
  /** Database client override (tests pass testPrisma). */
  db?: PrismaClient;
}

async function createGuestUser(
  prisma: PrismaClient,
  requestedName: string,
): Promise<{ id: string; name: string } | null> {
  for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt++) {
    // User.name is unique — retry with a numeric tag on collision
    const name =
      attempt === 0 ? requestedName : `${requestedName}#${1000 + Math.floor(Math.random() * 9000)}`;
    try {
      const user = await prisma.user.create({
        data: {
          name,
          isGuest: true,
          email: `guest-${crypto.randomUUID()}@guest.local`,
        },
        select: { id: true, name: true },
      });
      return { id: user.id, name: user.name ?? name };
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "P2002") throw error;
    }
  }
  return null;
}

export function registerGuestRoutes(app: Express, deps: GuestAuthDeps = {}): void {
  const prisma = deps.db ?? defaultPrisma;

  app.post("/auth/guest", (req: Request, res: Response) => {
    void (async () => {
      const body = validateRequest(guestBodySchema, req.body, res);
      if (!body) return;

      try {
        const user = await createGuestUser(prisma, body.name);
        if (!user) {
          res.status(409).json({ error: "name_taken" });
          return;
        }

        const token = await createJWT({ userId: user.id });
        await prisma.session.create({
          data: {
            userId: user.id,
            token,
            expiresAt: new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
          },
        });

        setSessionCookie(res, token);
        res.json({ userId: user.id, name: user.name });
      } catch (error) {
        logger.warn("Guest session creation failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ error: "guest_failed" });
      }
    })();
  });
}

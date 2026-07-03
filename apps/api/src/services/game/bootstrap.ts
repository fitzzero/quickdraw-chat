/**
 * Boot-time bootstrap for the global game world.
 *
 * The world row uses a deterministic id (GLOBAL_WORLD_ID) so the API, seed,
 * tests, and clients agree on it without a lookup, and so this upsert is
 * idempotent across restarts and test-database resets.
 */

import type { GameWorld, PrismaClient } from "@project/db";
import { GLOBAL_WORLD_ID, GLOBAL_WORLD_SLUG } from "@project/shared";

export const GLOBAL_WORLD_NAME = "Snake — Global";
export const GLOBAL_WORLD_CHAT_TITLE = "🌍 Game Server";

export async function ensureGlobalWorld(prisma: PrismaClient): Promise<GameWorld> {
  const world = await prisma.gameWorld.upsert({
    where: { id: GLOBAL_WORLD_ID },
    update: {},
    create: {
      id: GLOBAL_WORLD_ID,
      slug: GLOBAL_WORLD_SLUG,
      name: GLOBAL_WORLD_NAME,
    },
  });

  if (world.chatId) {
    // Guard against a dangling chatId (e.g. chat deleted via admin UI)
    const chat = await prisma.chat.findUnique({
      where: { id: world.chatId },
      select: { id: true },
    });
    if (chat) return world;
  }

  const chat = await prisma.chat.create({
    data: { title: GLOBAL_WORLD_CHAT_TITLE },
    select: { id: true },
  });

  return await prisma.gameWorld.update({
    where: { id: GLOBAL_WORLD_ID },
    data: { chatId: chat.id },
  });
}

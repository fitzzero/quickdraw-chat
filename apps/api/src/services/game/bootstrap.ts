/**
 * Boot-time bootstrap for the global game world.
 *
 * The world row uses a deterministic id (GLOBAL_WORLD_ID) so the API, seed,
 * tests, and clients agree on it without a lookup, and so this upsert is
 * idempotent across restarts and test-database resets.
 */

import type { GameWorld, PrismaClient } from "@project/db";
import {
  DEFINITION_TYPES,
  GLOBAL_WORLD_ID,
  GLOBAL_WORLD_SLUG,
  SNAKE_TUNABLES_KEY,
} from "@project/shared";
import type { GameTunables } from "./world.js";

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

/**
 * Load snake tunables from the DefinitionService row (seeded; may be
 * admin-edited). Returns {} when absent — the sim falls back to
 * DEFAULT_TUNABLES. Values are sanitized by GameWorldSim.applyTunables.
 */
export async function loadSnakeTunables(prisma: PrismaClient): Promise<Partial<GameTunables>> {
  const row = await prisma.definition.findUnique({
    where: { type_key: { type: DEFINITION_TYPES.tunables, key: SNAKE_TUNABLES_KEY } },
    select: { data: true, enabled: true },
  });
  if (!row?.enabled || typeof row.data !== "object" || row.data === null) return {};
  return row.data as Partial<GameTunables>;
}

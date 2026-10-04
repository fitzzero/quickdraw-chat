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
import type { db as appDb } from "../../db.js";
import { qd } from "../../quickdraw.js";
import type { GameTunables } from "./world.js";

type Db = typeof appDb;

export const GLOBAL_WORLD_NAME = "Snake — Global";
export const GLOBAL_WORLD_CHAT_TITLE = "🌍 Game Server";

/**
 * Makes the global world and its chat, once: through the tracked client in a
 * unit of work of its own (`qd.run`), so a server must exist (call it after
 * `createServer`, before listening).
 */
export async function ensureGlobalWorld(db: Db): Promise<GameWorld> {
  return await qd.run(async () => {
    const world = await db.gameWorld.upsert({
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
      const chat = await db.chat.findUnique({
        where: { id: world.chatId },
        select: { id: true },
      });
      if (chat) return world;
    }

    const chat = await db.chat.create({
      data: { title: GLOBAL_WORLD_CHAT_TITLE },
      select: { id: true },
    });

    return await db.gameWorld.update({
      where: { id: GLOBAL_WORLD_ID },
      data: { chatId: chat.id },
    });
  });
}

/**
 * A stored tunables object as the sim takes it: {} for anything but an
 * object. Values are sanitized by GameWorldSim.applyTunables.
 */
export function snakeTunablesOf(data: unknown): Partial<GameTunables> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
  return data as Partial<GameTunables>;
}

/**
 * Load snake tunables from the DefinitionService row (seeded; may be
 * admin-edited). Returns {} when absent — the sim falls back to
 * DEFAULT_TUNABLES.
 */
export async function loadSnakeTunables(prisma: PrismaClient): Promise<Partial<GameTunables>> {
  const row = await prisma.definition.findUnique({
    where: { type_key: { type: DEFINITION_TYPES.tunables, key: SNAKE_TUNABLES_KEY } },
    select: { data: true, enabled: true },
  });
  return row?.enabled ? snakeTunablesOf(row.data) : {};
}

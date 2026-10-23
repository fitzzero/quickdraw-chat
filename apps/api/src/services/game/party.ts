/**
 * Party worlds on the server (host mode): each party's row, its code, its
 * room and who hosts it. The world itself runs in the host's browser
 * (PartyWorld, in @project/shared), which serves the party's host-served
 * members (partyInput, partyWorld, partyEvents) over peer links: the server
 * never sees that traffic, and trusts nothing the host reports (no party
 * score is stored). What the server tells a party's room is how its host
 * hears who plays (partyPlayer, partyPlayerLeft) and how everyone hears the
 * party end (hostLeft, partyClosed). See .claude/rules/game-patterns.md.
 */

import { randomInt, randomUUID } from "node:crypto";
import { QuickdrawError } from "@fitzzero/quickdraw-core";
import type {
  ContextRooms,
  HostLeaveHandler,
  Presence,
  RoomLeft,
  ServerRooms,
} from "@fitzzero/quickdraw-core/server";
import {
  DEFAULT_TUNABLES,
  PARTY_CODE_ALPHABET,
  PARTY_CODE_PREFIX,
  PARTY_MAX_USERS,
  PARTY_TUNABLES,
  PARTY_WORLD_KIND,
  gameContract,
  partyOfRoom,
  partyRoom,
} from "@project/shared";
import type { db as appDb } from "../../db.js";
import { qd } from "../../quickdraw.js";
import { TTLCache } from "../../utils/ttl-cache.js";
import { activeGameRuntime } from "./runtime.js";

type Db = typeof appDb;

/** How many codes hostParty draws at once, to find one no party holds. */
const CODE_CANDIDATES = 5;

/** The characters after the code's prefix. */
const CODE_LENGTH = 4;

/** A party's world bounds: the sim's defaults under the party's tunables, which its host runs. */
export const PARTY_BOUNDS = {
  w: PARTY_TUNABLES.worldWidth ?? DEFAULT_TUNABLES.worldWidth,
  h: PARTY_TUNABLES.worldHeight ?? DEFAULT_TUNABLES.worldHeight,
};

/** A fresh code: the prefix and four random characters of the alphabet. */
function newPartyCode(): string {
  let code = PARTY_CODE_PREFIX;
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += PARTY_CODE_ALPHABET.charAt(randomInt(PARTY_CODE_ALPHABET.length));
  }
  return code;
}

/** A code as a player typed it, as stored: trimmed, in capitals ("bap-k7qd" finds BAP-K7QD). */
export function normalizePartyCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Makes a party's world row for its host, with a code no open party holds
 * (an ended party's code is free again): of CODE_CANDIDATES drawn at once,
 * the first none holds (one read). A party that takes the same code
 * meanwhile makes the write a unique violation, which the caller gets as
 * CONFLICT. Its slug says nothing of its code: getWorld finds no party.
 */
export async function createPartyRow(
  db: Db,
  hostUserId: string,
): Promise<{ id: string; code: string }> {
  const candidates = Array.from({ length: CODE_CANDIDATES }, newPartyCode);
  const held = await db.gameWorld.findMany({
    where: { code: { in: candidates } },
    select: { code: true },
    take: CODE_CANDIDATES,
  });
  const code = candidates.find((candidate) => !held.some((world) => world.code === candidate));
  if (code === undefined) throw new QuickdrawError("CONFLICT", "No free party code: try again");
  const world = await db.gameWorld.create({
    data: {
      slug: `party-${randomUUID()}`,
      name: `Party ${code}`,
      kind: PARTY_WORLD_KIND,
      code,
      hostUserId,
    },
    select: { id: true },
  });
  return { id: world.id, code };
}

/** An open party's row, as its methods read it. */
export interface OpenParty {
  readonly id: string;
  readonly code: string;
  readonly chatId: string | null;
  readonly hostUserId: string | null;
}

const PARTY_COLUMNS = {
  id: true,
  kind: true,
  code: true,
  chatId: true,
  hostUserId: true,
  closedAt: true,
} as const;

/** A row read as an open party: NOT_FOUND for a closed one, a server world or no row. */
function asOpenParty(
  world: {
    id: string;
    kind: string;
    code: string | null;
    chatId: string | null;
    hostUserId: string | null;
    closedAt: Date | null;
  } | null,
): OpenParty {
  if (world?.kind !== PARTY_WORLD_KIND || world.closedAt !== null || world.code === null) {
    throw new QuickdrawError("NOT_FOUND", "No open party is there");
  }
  return { id: world.id, code: world.code, chatId: world.chatId, hostUserId: world.hostUserId };
}

/** The open party a world id names. */
export async function openParty(db: Db, worldId: string): Promise<OpenParty> {
  return asOpenParty(
    await db.gameWorld.findUnique({ where: { id: worldId }, select: PARTY_COLUMNS }),
  );
}

/** The open party a code names, as a player typed it. */
export async function openPartyByCode(db: Db, code: string): Promise<OpenParty> {
  return asOpenParty(
    await db.gameWorld.findUnique({
      where: { code: normalizePartyCode(code) },
      select: PARTY_COLUMNS,
    }),
  );
}

/** What ends a party, as its room hears it. */
type PartyEnd = "partyClosed" | "hostLeft";

/** The rooms and presence a party's end goes through: a handler's `ctx`, or `qd` from a hook. */
interface PartyRooms {
  readonly rooms: ServerRooms;
  readonly presence: Presence;
}

/**
 * Ends parties: marks their rows closed and frees their codes, tells each
 * room why, leaves it without a host (a host that left has left it so
 * already) and takes every user out of it, which ends their peer links. The
 * room hears the end before anyone leaves it.
 */
export async function endParties(
  db: Db,
  { rooms, presence }: PartyRooms,
  worldIds: readonly string[],
  end: PartyEnd,
): Promise<void> {
  if (worldIds.length === 0) return;
  await db.gameWorld.updateMany({
    where: { id: { in: [...worldIds] }, closedAt: null },
    data: { closedAt: new Date(), code: null },
  });
  await Promise.all(
    worldIds.map(async (worldId) => {
      const room = partyRoom(worldId);
      rooms.emit(room, gameContract, end, { worldId });
      // quickdraw-5.0 finding: `qd.rooms` (core 5.1.3) has no clearHost or
      // hostOf at run time, though ServerRooms declares both; only a
      // handler's ctx.rooms has them. The host-leave hook passes qd.rooms, and
      // needs neither: its room has no host
      if (end === "partyClosed") rooms.clearHost(room);
      const users = await presence.users(room);
      await Promise.all(users.map((userId) => rooms.leave(room, { userId })));
    }),
  );
}

/** The open parties a user hosts: hostParty ends them first, since a socket is in one party at a time. */
export async function hostedParties(db: Db, hostUserId: string): Promise<string[]> {
  const worlds = await db.gameWorld.findMany({
    where: { kind: PARTY_WORLD_KIND, hostUserId, closedAt: null },
    select: { id: true },
    take: 20,
  });
  return worlds.map((world) => world.id);
}

/**
 * The party room each socket is in (this process's sockets: the game runs
 * on one). A socket is in one party at a time: a player's client sends
 * partyInput to the first party room whose host it knows.
 */
const partyRoomOfSocket = new Map<string, string>();

/**
 * Puts the calling socket in a party's room, and out of any other party's
 * first. A call without a socket joins nothing.
 */
export function enterPartyRoom(
  rooms: ContextRooms,
  socketId: string | undefined,
  room: string,
): void {
  if (socketId === undefined) return;
  const previous = partyRoomOfSocket.get(socketId);
  if (previous !== undefined && previous !== room) rooms.leave(previous);
  rooms.join(room);
  partyRoomOfSocket.set(socketId, room);
}

/** Forgets a socket's party room once it left it (onRoomLeave). */
export function partySocketLeft(socketId: string, left: readonly RoomLeft[]): void {
  const room = partyRoomOfSocket.get(socketId);
  if (room !== undefined && left.some((each) => each.room === room)) {
    partyRoomOfSocket.delete(socketId);
  }
}

/** Wrong codes a user may try within a minute before joinParty refuses them. */
const JOIN_MISSES_PER_MINUTE = 10;

/** Each user's wrong codes of the last minute (a minute after the last one, none). */
const joinMisses = new TTLCache<number>(60_000);

/**
 * Finds the open party a code names, for a user who has not tried too many
 * wrong codes: a code is short (31^4 of them), and this is its guard. A code
 * no open party holds counts as a wrong one.
 */
export async function openPartyForJoin(db: Db, userId: string, code: string): Promise<OpenParty> {
  const misses = joinMisses.get(userId) ?? 0;
  if (misses >= JOIN_MISSES_PER_MINUTE) {
    throw new QuickdrawError("RATE_LIMITED", "Too many wrong party codes: try again in a minute", {
      retryAfterMs: 60_000,
    });
  }
  // counted before the lookup, so guesses sent at once each count; a code
  // that finds a party gives its count back
  joinMisses.set(userId, misses + 1);
  const party = await openPartyByCode(db, code);
  joinMisses.set(userId, Math.max(0, (joinMisses.get(userId) ?? 1) - 1));
  return party;
}

/** Refuses a user a party whose room holds PARTY_MAX_USERS others. */
export async function assertRoomInParty(
  presence: Presence,
  room: string,
  userId: string,
): Promise<void> {
  const users = await presence.users(room);
  if (!users.includes(userId) && users.length >= PARTY_MAX_USERS) {
    throw new QuickdrawError("CONFLICT", "That party is full");
  }
}

/** The code is the invitation: only a user whose socket joinParty put in the room plays in it. */
export async function assertInParty(
  presence: Presence,
  room: string,
  userId: string,
): Promise<void> {
  if (!(await presence.users(room)).includes(userId)) {
    throw new QuickdrawError("FORBIDDEN", "Join the party first");
  }
}

/** The users whose hostParty runs now: one each at a time (two tabs would each make a party). */
const hostingNow = new Set<string>();

/** Runs `host` for a user whose other hostParty is not running, else CONFLICT. */
export async function oneHostPartyAtATime<T>(userId: string, host: () => Promise<T>): Promise<T> {
  if (hostingNow.has(userId))
    throw new QuickdrawError("CONFLICT", "You are starting a party already");
  hostingNow.add(userId);
  try {
    return await host();
  } finally {
    hostingNow.delete(userId);
  }
}

/**
 * The rooms a user's last socket left: a party's host hears it as
 * partyPlayerLeft, and takes the user's snake out (presence is room-anchored
 * in a party too: the user's page and game are two sockets).
 */
export function partyRoomsLeft(userId: string, left: readonly RoomLeft[]): void {
  for (const { room, last } of left) {
    const worldId = partyOfRoom(room);
    if (worldId !== null && last) {
      qd.rooms.emit(room, gameContract, "partyPlayerLeft", { worldId, id: userId });
    }
  }
}

/**
 * The host of a party left its room or disconnected: the party ends (no
 * other player is made its host), its room hears `hostLeft`, and everyone
 * leaves it. Writes through the game runtime's database, the one its root
 * built it with.
 */
export const onPartyHostLeave: HostLeaveHandler = async ({ room }) => {
  const worldId = partyOfRoom(room);
  const runtime = activeGameRuntime();
  if (worldId === null || runtime === undefined) return;
  await endParties(runtime.db, qd, [worldId], "hostLeft");
};

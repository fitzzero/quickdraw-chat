// A chat's members: the roster as the app shows it, and the one way a
// membership changes (invite, change of level, removal, leaving), under the
// sharing kit's rules.

import { QuickdrawError } from "@fitzzero/quickdraw-core";
import { meetsLevel, serviceGrant, type Principal } from "@fitzzero/quickdraw-core/server";
import type { Prisma } from "@project/db";
import type { AccessLevel, ChatMemberDTO } from "@project/shared";
import type { db as appDb } from "../../db.js";

type Db = typeof appDb;

/** The most members `getChatMembers` lists, and `memberUpdate` carries. */
const MAX_LISTED_MEMBERS = 500;

/** The levels a membership row holds (`ChatMember.level`), or `null` for anything else. */
function memberLevel(value: string | undefined): AccessLevel | null {
  return value === "Read" || value === "Moderate" || value === "Admin" ? value : null;
}

/** The higher of two levels; `null` when neither is one. */
function higherLevel(a: AccessLevel | null, b: AccessLevel | null): AccessLevel | null {
  if (a === null) return b;
  return b !== null && !meetsLevel(a, b) ? b : a;
}

/** A chat's members, oldest first, each with their level and public profile. */
export async function listMembers(db: Db, chatId: string): Promise<ChatMemberDTO[]> {
  const rows = await db.chatMember.findMany({
    where: { chatId },
    select: {
      id: true,
      userId: true,
      level: true,
      user: { select: { id: true, name: true, image: true } },
    },
    orderBy: { createdAt: "asc" },
    take: MAX_LISTED_MEMBERS,
  });
  return rows.map((row) => ({ ...row, level: memberLevel(row.level) ?? "Read" }));
}

/** One change to a chat's members: `userId` to hold `level` on `chatId`, or to leave it (`null`). */
export interface MembershipChange {
  readonly chatId: string;
  readonly userId: string;
  readonly level: AccessLevel | null;
  /** The caller leaving the chat themself: only the last-Admin rule applies. */
  readonly leaving?: boolean;
}

/**
 * The sharing kit's three rules for a change to a chat's members, the
 * caller's level being their membership's, or their service-wide
 * chatService grant when that is higher:
 *
 * 1. Nobody gives a level above their own (`FORBIDDEN`).
 * 2. Only an Admin changes or removes a member at or above the caller's own
 *    level (`FORBIDDEN`): a Moderate manages Read members, an Admin anyone.
 * 3. The chat keeps an Admin: its last Admin member cannot be removed,
 *    demoted or leave (`CONFLICT`).
 *
 * Reads inside the change's transaction; answers the member's level before
 * the change (`null` for none).
 */
async function checkChange(
  principal: Principal,
  tx: Prisma.TransactionClient,
  change: MembershipChange,
): Promise<AccessLevel | null> {
  const { chatId, userId, level } = change;
  // the caller's membership and the member's: two rows at most
  const rows = await tx.chatMember.findMany({
    where: { chatId, userId: { in: [...new Set([principal.userId, userId])] } },
    select: { userId: true, level: true },
    take: 2,
  });
  const levels = new Map(rows.map((row) => [row.userId, memberLevel(row.level)]));
  const levelOf = (id: string): AccessLevel | null => levels.get(id) ?? null;
  const before = levelOf(userId);
  if (change.leaving !== true) {
    const own = higherLevel(
      levelOf(principal.userId),
      serviceGrant(principal, "chatService") ?? null,
    );
    // a caller without a level changes nothing (the methods' access lets none in)
    if (own === null || (level !== null && !meetsLevel(own, level))) {
      throw new QuickdrawError("FORBIDDEN", "Nobody may give a level above their own on a chat");
    }
    if (before !== null && own !== "Admin" && meetsLevel(before, own)) {
      throw new QuickdrawError(
        "FORBIDDEN",
        "Only an Admin may change or remove a member at or above their own level",
      );
    }
  }
  if (before === "Admin" && level !== "Admin") {
    const anotherAdmin = await tx.chatMember.findFirst({
      where: { chatId, level: "Admin", userId: { not: userId } },
      select: { id: true },
    });
    if (anotherAdmin === null) {
      throw new QuickdrawError(
        "CONFLICT",
        "That user is the chat's last Admin; make another member Admin first",
      );
    }
  }
  return before;
}

/** Prisma's write conflict under SERIALIZABLE isolation (as the sharing kit tells it). */
function isWriteConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if ("code" in error && error.code === "P2034") return true;
  const cause: unknown = error.cause;
  return (
    error.name === "DriverAdapterError" &&
    typeof cause === "object" &&
    cause !== null &&
    "kind" in cause &&
    cause.kind === "TransactionWriteConflict"
  );
}

/** Prisma's foreign-key failure: the user (or the chat) does not exist. */
function isForeignKeyFailure(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "P2003";
}

/**
 * Makes one change to a chat's members, under the sharing kit's rules
 * (`checkChange`), in a SERIALIZABLE transaction: two changes at once
 * cannot both pass the rules (two last Admins leaving together). Answers
 * whether it wrote anything: a member set to the level they hold is left
 * as they are. Removing (or leaving as) a non-member is `NOT_FOUND`, as is
 * inviting an unknown user.
 */
export async function changeMembership(
  principal: Principal,
  db: Db,
  change: MembershipChange,
): Promise<boolean> {
  const { chatId, userId, level } = change;
  const where = { chatId_userId: { chatId, userId } };
  try {
    return await db.$transaction(
      async (tx) => {
        const before = await checkChange(principal, tx, change);
        if (level === null && before === null) {
          throw new QuickdrawError("NOT_FOUND", "That user is not a member of this chat");
        }
        if (level === before) return false;
        if (level === null) {
          await tx.chatMember.delete({ where, select: { id: true } });
        } else if (before === null) {
          await tx.chatMember.create({ data: { chatId, userId, level }, select: { id: true } });
        } else {
          await tx.chatMember.update({ where, data: { level }, select: { id: true } });
        }
        return true;
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (isWriteConflict(error)) {
      throw new QuickdrawError(
        "CONFLICT",
        "Another change to this chat's members ran at the same time; try again",
      );
    }
    if (isForeignKeyFailure(error)) {
      throw new QuickdrawError("NOT_FOUND", "No such user");
    }
    throw error;
  }
}

// ── quickdraw-game:start ──
/** Prisma's unique-constraint violation: the membership exists already. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "P2002";
}

/**
 * Makes `userId` a member of the chat at `level` when they are not one yet,
 * and writes nothing when they are: a join a page repeats on every load or
 * reconnect (the game's world chat) changes nothing the second time. Answers
 * whether it added them. No rules apply: the caller's method decides who may
 * join which chat.
 */
export async function joinChat(
  db: Db,
  chatId: string,
  userId: string,
  level: AccessLevel,
): Promise<boolean> {
  const existing = await db.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId } },
    select: { id: true },
  });
  if (existing !== null) return false;
  try {
    await db.chatMember.create({ data: { chatId, userId, level }, select: { id: true } });
    return true;
  } catch (error) {
    // another socket of the user joined them first (the page and the game
    // client watch the world at once)
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}
// ── quickdraw-game:end ──

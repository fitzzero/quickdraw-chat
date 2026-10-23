// Who may do what, pinned: every method, entity subscribe (qd:sub) and
// collection scope (qd:col:sub) of every service the API serves, as each
// principal and anonymously, against one set of seeded rows. A new service
// joins it, with a row of its own in `seed` and `rows`. The outcomes are in
// __access__/access-snapshot.int.test.ts.json: a change to an access form, a
// row policy or the kinds of principal fails here, naming each cell it moves
// and whether that opens or closes access, until the change is accepted with
// QD_UPDATE_ACCESS_SNAPSHOT=1 (locally; under CI a changed, added or removed
// cell fails) and the file is committed with it. Each service's own suite
// states the intent per method (describeAccessMatrix); this one also catches
// a change nobody wrote a case for.

import { snapshotAccessMatrix } from "@fitzzero/quickdraw-core/testing";
import { resetDatabase, testPrisma } from "@project/db/testing";
import type { AccessLevel } from "@project/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serviceNames } from "../../services/index.js";
import { createTestChat, createTestMessage } from "../factories/chat-factory.js";
import { createTestUser } from "../factories/user-factory.js";
import { agent, startTestApp, user, type ApiTestApp } from "../utils/app.js";

let app: ApiTestApp;

beforeAll(async () => {
  // pushes go nowhere, VAPID keys in the shell or not
  app = await startTestApp({ push: { transport: () => Promise.resolve() } });
});

afterAll(async () => {
  await app.close();
});

/** What `seed` made: the users, and one row of each service. */
interface Fixture {
  readonly owner: string;
  readonly moderator: string;
  readonly member: string;
  readonly stranger: string;
  readonly admin: string;
  readonly serviceModerator: string;
  readonly chat: string;
  readonly message: string;
  readonly document: string;
  readonly subscription: string;
  // ── quickdraw-game:start ──
  readonly world: string;
  readonly definition: string;
  // ── quickdraw-game:end ──
}

/** A service-wide grant of `level` on every service the API serves. */
function grantsOf(level: AccessLevel): Record<string, AccessLevel> {
  return Object.fromEntries(serviceNames().map((name) => [name, level]));
}

/**
 * Empties the database and seeds it, with the untracked client: the owner's
 * chat, with a moderator (Moderate) and a member (Read) in it and the
 * member's message; the owner's document, shared with the same two at the
 * same levels; the owner's push subscription; a stranger in none of them;
 * and two users with a service-wide grant on every service and no row, one
 * Admin and one Moderate.
 */
async function seed(): Promise<Fixture> {
  await resetDatabase();
  const [owner, moderator, member, stranger, admin, serviceModerator] = await Promise.all([
    createTestUser({ name: "Owner" }),
    createTestUser({ name: "Moderator" }),
    createTestUser({ name: "Member" }),
    createTestUser({ name: "Stranger" }),
    createTestUser({ name: "Admin", serviceAccess: grantsOf("Admin") }),
    createTestUser({ name: "Service Moderator", serviceAccess: grantsOf("Moderate") }),
  ]);
  const chat = await createTestChat({
    title: "Owner's chat",
    members: [
      { userId: owner.id, level: "Admin" },
      { userId: moderator.id, level: "Moderate" },
      { userId: member.id, level: "Read" },
    ],
  });
  const [message, document, subscription] = await Promise.all([
    // Admin on it as its author, where the chat gives them Read
    createTestMessage({ chatId: chat.id, userId: member.id }),
    testPrisma.document.create({
      data: {
        title: "Owner's notes",
        ownerId: owner.id,
        acl: [
          { userId: moderator.id, level: "Moderate" },
          { userId: member.id, level: "Read" },
        ],
      },
      select: { id: true },
    }),
    testPrisma.pushSubscription.create({
      data: {
        userId: owner.id,
        endpoint: "https://push.test/owner",
        p256dh: "key",
        auth: "secret",
      },
      select: { id: true },
    }),
  ]);
  // ── quickdraw-game:start ──
  const [world, definition] = await Promise.all([
    // not the one world the sim runs (GLOBAL_WORLD_ID): the play methods
    // answer NOT_FOUND to whoever passes their access check, before the
    // in-memory sim, which a reset of the database cannot undo. A party the
    // owner hosts (no socket hosts it: the party methods that need one refuse
    // after their access check), so the policy's host rule has its cells
    testPrisma.gameWorld.create({
      data: { slug: "world", name: "World", kind: "party", code: "BAP-SNAP", hostUserId: owner.id },
      select: { id: true },
    }),
    testPrisma.definition.create({
      data: { type: "items", key: "apple", data: { points: 1 } },
      select: { id: true },
    }),
  ]);
  // ── quickdraw-game:end ──
  return {
    owner: owner.id,
    moderator: moderator.id,
    member: member.id,
    stranger: stranger.id,
    admin: admin.id,
    serviceModerator: serviceModerator.id,
    chat: chat.id,
    message: message.id,
    document: document.id,
    subscription: subscription.id,
    // ── quickdraw-game:start ──
    world: world.id,
    definition: definition.id,
    // ── quickdraw-game:end ──
  };
}

describe("the access snapshot", () => {
  it("pins who may call what, for every method, subscribe and scope", async () => {
    const report = await snapshotAccessMatrix(app, {
      principals: (seeded) => ({
        // a level on the rows: Admin, Moderate, Read, none
        owner: user(seeded.owner),
        moderator: user(seeded.moderator),
        member: user(seeded.member),
        stranger: user(seeded.stranger),
        // a service-wide grant on every service, and no row
        admin: user(seeded.admin),
        serviceModerator: user(seeded.serviceModerator),
        // agents acting for a person, as the MCP server's caller: what a
        // method with kinds: ["user"] refuses whatever the person's grants
        agent: agent(seeded.owner),
        agentAdmin: agent(seeded.admin),
      }),
      reset: seed,
      rows: (seeded) => ({
        chatService: seeded.chat,
        messageService: seeded.message,
        documentService: seeded.document,
        // whose row it is
        userService: { owner: seeded.owner, member: seeded.member },
        pushService: seeded.subscription,
        // ── quickdraw-game:start ──
        // scripts/strip-game.mjs drops the game's cells from the snapshot
        // file, as a fork without the game records none
        gameService: seeded.world,
        definitionService: seeded.definition,
        // ── quickdraw-game:end ──
      }),
      // a real user to invite, remove or share with, and a row to create:
      // made inputs name no user and hold no data, so a cell access lets
      // through would fail after the check (NOT_FOUND, VALIDATION)
      inputs: (ref, seeded) => {
        const given: Readonly<Record<string, unknown>> = {
          "chatService.inviteUser": { id: ref.row, userId: seeded.stranger, level: "Read" },
          "chatService.removeUser": { id: ref.row, userId: seeded.member },
          "chatService.adminCreate": { data: { title: "Created" } },
          "documentService.share": { id: ref.row, userId: seeded.stranger, level: "Read" },
          "documentService.setLevel": { id: ref.row, userId: seeded.member, level: "Moderate" },
          "documentService.unshare": { id: ref.row, userId: seeded.member },
          "userService.adminCreate": { data: { email: "created@test.com", name: "Created" } },
          // ── quickdraw-game:start ──
          "definitionService.adminCreate": {
            data: { type: "items", key: "pear", data: { points: 2 } },
          },
          // ── quickdraw-game:end ──
        };
        return given[`${ref.service}.${ref.method}`];
      },
    });
    expect(report.inconclusive).toEqual([]);
  }, 60_000);
});

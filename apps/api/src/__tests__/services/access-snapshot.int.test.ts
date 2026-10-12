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
// what nobody thought to state.

import { snapshotAccessMatrix } from "@fitzzero/quickdraw-core/testing";
import { resetDatabase, testPrisma } from "@project/db/testing";
import { afterAll, beforeAll, expect, it } from "vitest";
import { serviceNames, services } from "../../services/index.js";
import { createTestChat, createTestMessage } from "../factories/chat-factory.js";
import { createTestUser } from "../factories/user-factory.js";
import { agent, startTestApp, user, type ApiTestApp } from "../utils/app.js";
// ── quickdraw-game:start ──
import { gameService } from "../../services/game/index.js";
// ── quickdraw-game:end ──

/** The services whose state a reset of the database cannot undo: their own suites pin them. */
const outside = new Set<string>([
  // ── quickdraw-game:start ──
  // the game's methods act on the in-memory sim (its matrix is in game.int.test.ts)
  gameService.name,
  // ── quickdraw-game:end ──
]);

let app: ApiTestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
});

/** What `seed` made: the users, and one row of each service. */
interface Fixture {
  readonly owner: string;
  readonly member: string;
  readonly stranger: string;
  readonly admin: string;
  readonly chat: string;
  readonly message: string;
  readonly document: string;
  readonly subscription: string;
  // ── quickdraw-game:start ──
  readonly world: string;
  readonly definition: string;
  // ── quickdraw-game:end ──
}

/**
 * Empties the database and seeds it, with the untracked client: the owner's
 * chat (the member in it at Read) with the owner's message, the owner's
 * document (shared with the member at Read) and push subscription, a
 * stranger in none of them, and a user with a service-wide Admin grant on
 * every service.
 */
async function seed(): Promise<Fixture> {
  await resetDatabase();
  const admin = Object.fromEntries(serviceNames().map((name) => [name, "Admin" as const]));
  const [owner, member, stranger, administrator] = await Promise.all([
    createTestUser({ name: "Owner" }),
    createTestUser({ name: "Member" }),
    createTestUser({ name: "Stranger" }),
    createTestUser({ name: "Administrator", serviceAccess: admin }),
  ]);
  const chat = await createTestChat({
    title: "Owner's chat",
    members: [{ userId: owner.id }, { userId: member.id }],
  });
  const [message, document, subscription] = await Promise.all([
    createTestMessage({ chatId: chat.id, userId: owner.id }),
    testPrisma.document.create({
      data: {
        title: "Owner's notes",
        ownerId: owner.id,
        acl: [{ userId: member.id, level: "Read" }],
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
    testPrisma.gameWorld.create({ data: { slug: "world", name: "World" }, select: { id: true } }),
    testPrisma.definition.create({
      data: { type: "items", key: "apple", data: { points: 1 } },
      select: { id: true },
    }),
  ]);
  // ── quickdraw-game:end ──
  return {
    owner: owner.id,
    member: member.id,
    stranger: stranger.id,
    admin: administrator.id,
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

it("pins who may call what, for every method, subscribe and scope", async () => {
  const report = await snapshotAccessMatrix(app, {
    services: services.filter((service) => !outside.has(service.name)),
    principals: (seeded) => ({
      owner: user(seeded.owner),
      member: user(seeded.member),
      stranger: user(seeded.stranger),
      admin: user(seeded.admin),
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
      // the owner's own row, and another user's
      userService: { own: seeded.owner, other: seeded.member },
      pushService: seeded.subscription,
      // ── quickdraw-game:start ──
      // joinWorldChat's scope; scripts/strip-game.mjs drops the game's cells
      // from the snapshot file, as a fork without the game records none
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
}, 30_000);

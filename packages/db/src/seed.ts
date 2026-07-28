/**
 * Seed demo data for local development.
 *
 * Creates three demo users (the accounts shown in the mock OAuth sign-in
 * picker), a welcome chat with all three as members at different access
 * levels, and a sample document. Idempotent: skips when the demo admin
 * already exists. Run with `bun run db:seed`.
 */

import { disconnectPrisma, prisma } from "./index.js";

const DEMO_ADMIN_EMAIL = "admin@demo.local";

async function seedUsers(): Promise<{ adminId: string; moderatorId: string; userId: string }> {
  const admin = await prisma.user.create({
    data: {
      email: DEMO_ADMIN_EMAIL,
      name: "Demo Admin",
      serviceAccess: {
        userService: "Admin",
        chatService: "Admin",
        messageService: "Admin",
        documentService: "Admin",
        // ── quickdraw-game:start ──
        gameService: "Admin",
        definitionService: "Admin",
        // ── quickdraw-game:end ──
      },
    },
  });

  const moderator = await prisma.user.create({
    data: {
      email: "moderator@demo.local",
      name: "Demo Moderator",
      serviceAccess: {
        userService: "Read",
        chatService: "Moderate",
        messageService: "Moderate",
        documentService: "Moderate",
      },
    },
  });

  const user = await prisma.user.create({
    data: {
      email: "user@demo.local",
      name: "Demo User",
      serviceAccess: {
        userService: "Read",
      },
    },
  });

  return { adminId: admin.id, moderatorId: moderator.id, userId: user.id };
}

async function seedChat(ids: {
  adminId: string;
  moderatorId: string;
  userId: string;
}): Promise<void> {
  const chat = await prisma.chat.create({
    data: {
      title: "Welcome 👋",
      members: {
        create: [
          { userId: ids.adminId, level: "Admin" },
          { userId: ids.moderatorId, level: "Moderate" },
          { userId: ids.userId, level: "Read" },
        ],
      },
    },
  });

  const messages: Array<{ userId: string; content: string }> = [
    {
      userId: ids.adminId,
      content: "Welcome to the demo chat! This data comes from packages/db/src/seed.ts.",
    },
    {
      userId: ids.moderatorId,
      content: "Each demo user has a different access level — admin, moderator, and read-only.",
    },
    {
      userId: ids.userId,
      content: "Sign in as any of us through the mock OAuth picker on the login page.",
    },
    {
      userId: ids.adminId,
      content: "Open two browsers with different demo users to watch real-time sync in action.",
    },
  ];

  for (const message of messages) {
    await prisma.message.create({
      data: {
        chatId: chat.id,
        userId: message.userId,
        content: message.content,
        acl: [{ userId: message.userId, level: "Admin" }],
      },
    });
  }
}

async function seedDocument(ids: { adminId: string; moderatorId: string }): Promise<void> {
  await prisma.document.create({
    data: {
      title: "Getting started",
      content:
        "# Getting started\n\n" +
        "This sample document demonstrates the JSON ACL pattern: the owner has " +
        "full access and the demo moderator was granted Read via the acl field.\n",
      ownerId: ids.adminId,
      acl: [{ userId: ids.moderatorId, level: "Read" }],
    },
  });
}

// ── quickdraw-game:start ──
/**
 * The global game world + its chat. Uses the same deterministic id as the
 * API's boot-time bootstrap (ensureGlobalWorld), so seeding and booting in
 * either order converges on the same row.
 */
async function seedGameWorld(ids: { adminId: string }): Promise<void> {
  const GLOBAL_WORLD_ID = "gameworld_global";

  const existing = await prisma.gameWorld.findUnique({ where: { id: GLOBAL_WORLD_ID } });
  if (existing?.chatId) return;

  const chat = await prisma.chat.create({
    data: {
      title: "🌍 Game Server",
      members: { create: [{ userId: ids.adminId, level: "Admin" }] },
    },
  });

  await prisma.gameWorld.upsert({
    where: { id: GLOBAL_WORLD_ID },
    update: { chatId: chat.id },
    create: {
      id: GLOBAL_WORLD_ID,
      slug: "global",
      name: "Snake — Global",
      chatId: chat.id,
    },
  });

  await prisma.message.create({
    data: {
      chatId: chat.id,
      userId: ids.adminId,
      content: "Welcome to the game server chat — everyone who joins the game lands here.",
      acl: [{ userId: ids.adminId, level: "Admin" }],
    },
  });
}

/**
 * Snake movement tunables as a Definition row. Must mirror DEFAULT_TUNABLES
 * in apps/api/src/services/game/world.ts — the server sim loads these at
 * boot (and hot-reloads on admin edit); the Godot client fetches them at
 * load. Edit via /admin/definitionService — no re-export needed.
 */
async function seedDefinitions(): Promise<void> {
  await prisma.definition.upsert({
    where: { type_key: { type: "tunables", key: "snake" } },
    update: {},
    create: {
      type: "tunables",
      key: "snake",
      data: {
        baseSpeed: 180,
        boostSpeed: 320,
        turnRate: 4,
        startLength: 10,
        minLength: 5,
        boostBurnPerSecond: 1.5,
        foodRadius: 14,
        maxFood: 150,
      },
    },
  });
}
// ── quickdraw-game:end ──

async function main(): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_ADMIN_EMAIL } });
  if (existing) {
    console.log("Demo data already seeded — skipping.");
    return;
  }

  const ids = await seedUsers();
  await seedChat(ids);
  await seedDocument(ids);
  // ── quickdraw-game:start ──
  await seedGameWorld(ids);
  await seedDefinitions();
  // ── quickdraw-game:end ──

  console.log("Seeded demo users:");
  console.log(`  admin@demo.local      (Admin on all services)`);
  console.log(`  moderator@demo.local  (Moderate on chat/message/document)`);
  console.log(`  user@demo.local       (Read on userService only)`);
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());

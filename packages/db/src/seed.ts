/**
 * Seed demo data for local development.
 *
 * Creates three demo users (the accounts shown in the mock OAuth sign-in
 * picker), a welcome chat with all three as members at different access
 * levels, and a sample document. Idempotent: skips when the demo admin
 * already exists. Run with `bun run db:seed`.
 */

import { prisma } from "./index.js";

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

async function main(): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_ADMIN_EMAIL } });
  if (existing) {
    console.log("Demo data already seeded — skipping.");
    return;
  }

  const ids = await seedUsers();
  await seedChat(ids);
  await seedDocument(ids);

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
  .finally(() => prisma.$disconnect());

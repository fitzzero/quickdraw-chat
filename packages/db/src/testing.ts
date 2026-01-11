import { PrismaClient } from "../prisma/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

// Test database client singleton
const globalForTestPrisma = globalThis as unknown as {
  testPrisma: PrismaClient | undefined;
};

function createTestPrismaClient(): PrismaClient {
  const connectionString =
    process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "TEST_DATABASE_URL or DATABASE_URL environment variable is not set"
    );
  }

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log: ["error"],
  });
}

export const testPrisma =
  globalForTestPrisma.testPrisma ?? createTestPrismaClient();

if (process.env.NODE_ENV === "test") {
  globalForTestPrisma.testPrisma = testPrisma;
}

/**
 * Reset the test database by truncating all tables.
 * Tables are truncated in reverse dependency order.
 */
export async function resetDatabase(): Promise<void> {
  // Truncate tables in order that respects foreign key constraints
  await testPrisma.$executeRaw`TRUNCATE TABLE "messages" CASCADE`;
  await testPrisma.$executeRaw`TRUNCATE TABLE "chat_members" CASCADE`;
  await testPrisma.$executeRaw`TRUNCATE TABLE "chats" CASCADE`;
  await testPrisma.$executeRaw`TRUNCATE TABLE "documents" CASCADE`;
  await testPrisma.$executeRaw`TRUNCATE TABLE "sessions" CASCADE`;
  await testPrisma.$executeRaw`TRUNCATE TABLE "accounts" CASCADE`;
  await testPrisma.$executeRaw`TRUNCATE TABLE "users" CASCADE`;
}

/**
 * Seed test users with specific service access levels.
 */
export async function seedTestUsers(): Promise<{
  admin: { id: string; email: string };
  moderator: { id: string; email: string };
  regular: { id: string; email: string };
}> {
  const [admin, moderator, regular] = await Promise.all([
    testPrisma.user.create({
      data: {
        email: "admin@test.com",
        name: "Admin User",
        serviceAccess: {
          chatService: "Admin",
          userService: "Admin",
          messageService: "Admin",
        },
      },
      select: { id: true, email: true },
    }),
    testPrisma.user.create({
      data: {
        email: "moderator@test.com",
        name: "Moderator User",
        serviceAccess: {
          chatService: "Moderate",
        },
      },
      select: { id: true, email: true },
    }),
    testPrisma.user.create({
      data: {
        email: "user@test.com",
        name: "Regular User",
      },
      select: { id: true, email: true },
    }),
  ]);

  return { admin, moderator, regular };
}

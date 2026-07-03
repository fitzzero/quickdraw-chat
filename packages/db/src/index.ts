import { PrismaClient } from "../prisma/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// Singleton pattern for Prisma client with lazy initialization
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaPool: Pool | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  // Configure connection pool for production
  // Default pool size is suitable for serverless (Cloud Run, Lambda)
  // Adjust based on your deployment environment
  // max/min connections via DB_POOL_MAX/DB_POOL_MIN; idle connections close
  // after 30s; acquiring a connection times out after 10s
  const pool = new Pool({
    connectionString,
    max: parseInt(process.env.DB_POOL_MAX ?? "20", 10),
    min: parseInt(process.env.DB_POOL_MIN ?? "5", 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  pool.on("error", (err) => {
    // stderr intentional — this fires outside request context when an idle
    // client encounters a backend termination or network drop.
    process.stderr.write(`[PG Pool] Unexpected idle client error: ${err.message}\n`);
  });

  const adapter = new PrismaPg(pool);

  globalForPrisma.prismaPool = pool;
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
}

/**
 * Disconnect the client AND end the pg pool. Prisma does not end an
 * externally-owned pool, and its min idle connections otherwise keep the
 * process alive — one-shot scripts (seed, jobs) must call this to exit.
 */
export async function disconnectPrisma(): Promise<void> {
  await globalForPrisma.prisma?.$disconnect();
  await globalForPrisma.prismaPool?.end();
  globalForPrisma.prisma = undefined;
  globalForPrisma.prismaPool = undefined;
}

// Lazy getter - only creates the client when first accessed
export const prisma = new Proxy({} as PrismaClient, {
  get(_target: PrismaClient, prop: string | symbol): unknown {
    globalForPrisma.prisma ??= createPrismaClient();
    return Reflect.get(globalForPrisma.prisma, prop) as unknown;
  },
});

// Re-export the Prisma client module. `export *` includes PrismaClient as
// both a value (for `new PrismaClient(...)` in tests) and a type.
export * from "../prisma/generated/prisma/client.js";

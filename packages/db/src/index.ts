import { PrismaClient } from "../prisma/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// Singleton pattern for Prisma client with lazy initialization
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  // Configure connection pool for production
  // Default pool size is suitable for serverless (Cloud Run, Lambda)
  // Adjust based on your deployment environment
  const pool = new Pool({
    connectionString,
    max: parseInt(process.env.DB_POOL_MAX ?? "20", 10), // Maximum connections
    min: parseInt(process.env.DB_POOL_MIN ?? "5", 10), // Minimum connections
    idleTimeoutMillis: 30000, // Close idle connections after 30s
    connectionTimeoutMillis: 10000, // Timeout for acquiring connection
  });

  pool.on("error", (err) => {
    // stderr intentional — this fires outside request context when an idle
    // client encounters a backend termination or network drop.
    process.stderr.write(`[PG Pool] Unexpected idle client error: ${err.message}\n`);
  });

  const adapter = new PrismaPg(pool);

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });
}

// Lazy getter - only creates the client when first accessed
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop): unknown {
    globalForPrisma.prisma ??= createPrismaClient();
    return Reflect.get(globalForPrisma.prisma, prop) as unknown;
  },
});

// Re-export the Prisma client module. `export *` includes PrismaClient as
// both a value (for `new PrismaClient(...)` in tests) and a type.
export * from "../prisma/generated/prisma/client.js";

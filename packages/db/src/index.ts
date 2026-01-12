import { PrismaClient } from "../prisma/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

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
  const adapter = new PrismaPg({ 
    connectionString,
    pool: {
      max: parseInt(process.env.DB_POOL_MAX ?? "20", 10), // Maximum connections
      min: parseInt(process.env.DB_POOL_MIN ?? "5", 10),  // Minimum connections
      idleTimeoutMillis: 30000, // Close idle connections after 30s
      connectionTimeoutMillis: 10000, // Timeout for acquiring connection
    },
  });

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

// Lazy getter - only creates the client when first accessed
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop): unknown {
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = createPrismaClient();
    }
    return Reflect.get(globalForPrisma.prisma, prop) as unknown;
  },
});

// Re-export Prisma types for convenience
export type { PrismaClient } from "../prisma/generated/prisma/client.js";
export * from "../prisma/generated/prisma/client.js";

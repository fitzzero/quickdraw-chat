import { PrismaClient } from "../prisma/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { trackPrisma, type Tracked } from "@fitzzero/quickdraw-core/prisma";
import { Pool } from "pg";

// Singleton pattern for Prisma client with lazy initialization
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  prismaPool: Pool | undefined;
  db: Tracked<PrismaClient> | undefined;
};

/**
 * What the client logs: errors, plus warnings under NODE_ENV development
 * (bun run dev), and every statement there only on request
 * (PRISMA_LOG_QUERIES=true), since a log of each query drowns the API's own.
 */
function logLevels(): ("query" | "warn" | "error")[] {
  if (process.env.NODE_ENV !== "development") return ["error"];
  return process.env.PRISMA_LOG_QUERIES === "true" ? ["query", "error", "warn"] : ["error", "warn"];
}

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
  return new PrismaClient({ adapter, log: logLevels() });
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
  globalForPrisma.db = undefined;
}

function untrackedClient(): PrismaClient {
  globalForPrisma.prisma ??= createPrismaClient();
  return globalForPrisma.prisma;
}

/**
 * The untracked client: quickdraw never sees its writes, so nobody
 * subscribed hears about them. For seeds, one-off scripts, the auth routes'
 * session store (sessions are not live data) and the bootstrap admin's
 * grants (`apps/api/src/auth/grants.ts`); everything else writes through
 * {@link db}.
 * ── quickdraw-game:start ──
 * The guest sign-in creates its users through it too: no subscriber can
 * hold a user made that moment.
 * ── quickdraw-game:end ──
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target: PrismaClient, prop: string | symbol): unknown {
    return Reflect.get(untrackedClient(), prop) as unknown;
  },
});

/**
 * The tracked client (`trackPrisma`, applied last): every write through it
 * reaches the quickdraw server's flush, which sends entity frames and
 * collection deltas to subscribers. The one client the API server, the MCP
 * server and the services write through (handlers receive it as `db`); the
 * tests and the bench track their own database the same way
 * (`@project/db/testing`). Created on first use, like {@link prisma}, so
 * importing this module needs no `DATABASE_URL`. Its type carries
 * quickdraw's mark (`Tracked<PrismaClient>`), so a helper that writes takes
 * it by that type and the untracked {@link prisma} handed to one is a type
 * error.
 */
export const db: Tracked<PrismaClient> = new Proxy({} as Tracked<PrismaClient>, {
  get(_target: Tracked<PrismaClient>, prop: string | symbol): unknown {
    globalForPrisma.db ??= trackPrisma(untrackedClient());
    return Reflect.get(globalForPrisma.db, prop) as unknown;
  },
});

// Re-export the Prisma client module. `export *` includes PrismaClient as
// both a value (for `new PrismaClient(...)` in tests) and a type.
export * from "../prisma/generated/prisma/client.js";

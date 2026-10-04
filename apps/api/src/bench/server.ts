/**
 * Bench server bootstrap — the integration-test server recipe
 * (__tests__/utils/app.ts + setup.ts) minus vitest, plus a RUNNING game
 * loop and the ground-truth recorder. PGlite by default (the tick path is
 * DB-free; score writes are fire-and-forget), real PostgreSQL when
 * TEST_DATABASE_URL is set.
 *
 * quickdraw-game: the minimal 5.0 port. The server is 5.0's; the bots
 * (`bot/client.ts`) still speak the 4.x wire, which a 5.0 server refuses, so
 * the netcode bench runs again with the game's port (child 4).
 *
 * IMPORTANT: import this module only AFTER setting the bench env
 * (see setupBenchEnv in run.ts) — services read env at import time.
 */

import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@project/db";
import { setTestPrisma, testDb, testPrisma } from "@project/db/testing";
import type { Scenario } from "@project/bench";
import { createPrismaTestGlobalSetup } from "@fitzzero/quickdraw-core/testing/prisma";
import { devCredentialsPrincipal } from "../auth/dev-credentials.js";
import { createGrantsLoader } from "../auth/grants.js";
import { qd } from "../quickdraw.js";
import { serviceNames, services } from "../services/index.js";
import { ensureGlobalWorld } from "../services/game/bootstrap.js";
import { createGameRuntime, type GameRuntime } from "../services/game/runtime.js";
import { createGroundTruthRecorder, type GroundTruthRecorder } from "./ground-truth.js";

export interface BenchServer {
  port: number;
  game: GameRuntime;
  recorder: GroundTruthRecorder;
  /** bot name → user id, one distinct user per bot (rate limits key by user) */
  users: Map<string, string>;
  stop: () => Promise<void>;
}

let dbReady = false;
let pgliteClose: (() => Promise<void>) | null = null;

/** Build/reuse the migrated test-database template, then connect. Once per process. */
async function ensureDatabase(): Promise<void> {
  if (dbReady) return;

  const setup = createPrismaTestGlobalSetup({
    migrationsDir: resolve(process.cwd(), "../../packages/db/prisma/migrations"),
    templateDbName: "quickdraw_chat_test",
    templateName: "quickdraw-chat-test-template",
    workerCount: 1,
  });
  await setup();

  if (!process.env.TEST_DATABASE_URL) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { PrismaPGlite } = await import("pglite-prisma-adapter");
    const templatePath = resolve(
      process.cwd(),
      "node_modules/.cache/quickdraw-chat-test-template.tar.gz",
    );
    const blob = new Blob([readFileSync(templatePath)], { type: "application/x-gzip" });
    const pglite = new PGlite({ loadDataDir: blob });
    await pglite.waitReady;
    const adapter = new PrismaPGlite(pglite);
    setTestPrisma(new PrismaClient({ adapter, log: [] }));
    pgliteClose = () => pglite.close();
  }
  dbReady = true;
}

export async function startBenchServer(scenario: Scenario): Promise<BenchServer> {
  await ensureDatabase();
  await ensureGlobalWorld(testPrisma);

  const users = new Map<string, string>();
  for (const spec of scenario.clients) {
    const user = await testPrisma.user.upsert({
      where: { email: `${spec.name}@bench.local` },
      update: {},
      create: { email: `${spec.name}@bench.local`, name: spec.name },
      select: { id: true },
    });
    users.set(spec.name, user.id);
  }

  const recorder = createGroundTruthRecorder();
  const game = createGameRuntime(testDb, {
    simSeed: scenario.seed,
    tunables: scenario.tunables ?? {},
    onTick: recorder.onTick,
  });

  // Benchmarks measure timing — keep the hot path free of console I/O
  const silent = (): void => undefined;
  const silentLogger = {
    info: silent,
    warn: silent,
    error: (message: string, meta?: unknown) => console.error(`[ERROR] ${message}`, meta ?? ""),
    debug: silent,
    child: () => silentLogger,
  };

  const server = qd.createServer({
    services,
    db: testDb,
    logger: silentLogger,
    // Tier 2 connects real browsers (pages served from the web dev server)
    cors: { origin: [process.env.CLIENT_URL ?? "http://localhost:3000"], credentials: true },
    // bots sign in with development credentials (auth.userId)
    auth: {
      authenticate: ({ auth }) => devCredentialsPrincipal(testPrisma, auth),
      loadServiceAccess: createGrantsLoader({ prisma: testPrisma, serviceNames }),
    },
  });
  await new Promise<void>((resolvePort) => {
    server.httpServer.listen(0, () => resolvePort());
  });
  const { port } = server.httpServer.address() as AddressInfo;

  game.loop.start();

  return {
    port,
    game,
    recorder,
    users,
    stop: async () => {
      game.loop.stop();
      await server.close();
    },
  };
}

/** Final cleanup for a bench process (PGlite handle). */
export async function shutdownBenchDatabase(): Promise<void> {
  if (pgliteClose) await pgliteClose();
  pgliteClose = null;
  dbReady = false;
}

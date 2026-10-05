/**
 * Bench server bootstrap — the integration-test server recipe
 * (__tests__/utils/app.ts + setup.ts) minus vitest, plus a RUNNING game
 * loop and the ground-truth recorder. PGlite by default (the tick path is
 * DB-free; score writes are fire-and-forget), real PostgreSQL when
 * TEST_DATABASE_URL is set. The bots sign in as the Godot editor does: the
 * app's own `authenticate` with development credentials (`auth: { userId }`).
 *
 * IMPORTANT: import this module only AFTER setting the bench env
 * (see run.ts) — the app's sign-in reads ENABLE_DEV_CREDENTIALS when built.
 */

import type { AddressInfo } from "node:net";
import { PrismaClient } from "@project/db";
import { setTestPrisma, testDb, testPrisma } from "@project/db/testing";
import type { Scenario } from "@project/bench";
import {
  createPrismaTestGlobalSetup,
  openPgliteFromTemplate,
} from "@fitzzero/quickdraw-core/testing/prisma";
import { TEST_TEMPLATE } from "../__tests__/utils/test-template.js";
import { createAppAuth } from "../auth/index.js";
import { qd } from "../quickdraw.js";
import { serviceNames, services } from "../services/index.js";
import { ensureGlobalWorld } from "../services/game/bootstrap.js";
import {
  createGameRuntime,
  onGameRoomLeave,
  worldAudience,
  type GameRuntime,
} from "../services/game/runtime.js";
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
    ...TEST_TEMPLATE,
    templateDbName: "quickdraw_chat_test",
    workerCount: 1,
  });
  await setup();

  if (!process.env.TEST_DATABASE_URL) {
    const { PrismaPGlite } = await import("pglite-prisma-adapter");
    const pglite = await openPgliteFromTemplate(TEST_TEMPLATE);
    setTestPrisma(new PrismaClient({ adapter: new PrismaPGlite(pglite), log: [] }));
    pgliteClose = () => pglite.close();
  }
  dbReady = true;
}

export interface BenchServerOptions {
  /** The port to listen on; default any free one. The Godot check restarts on the same one. */
  readonly port?: number;
}

export async function startBenchServer(
  scenario: Scenario,
  options: BenchServerOptions = {},
): Promise<BenchServer> {
  await ensureDatabase();

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
    auth: createAppAuth({ prisma: testPrisma, serviceNames }).server,
    // a bot whose socket left the world leaves the sim, as a player does
    onRoomLeave: onGameRoomLeave,
  });
  await ensureGlobalWorld(testDb);
  const game = createGameRuntime(testDb, {
    simSeed: scenario.seed,
    tunables: scenario.tunables ?? {},
    hasAudience: worldAudience(server),
    onTick: recorder.onTick,
  });
  await new Promise<void>((resolvePort) => {
    server.httpServer.listen(options.port ?? 0, () => resolvePort());
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

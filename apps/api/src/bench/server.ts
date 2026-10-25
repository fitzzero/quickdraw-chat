/**
 * Bench server bootstrap — the integration-test server recipe
 * (__tests__/utils/app.ts + setup.ts) minus vitest, plus a RUNNING game
 * loop and the ground-truth recorder. PGlite by default (the tick path is
 * DB-free; score writes are fire-and-forget), real PostgreSQL when
 * TEST_DATABASE_URL is set. The bots sign in with the app's own
 * `authenticate` and development credentials (`auth: { userId }`).
 *
 * IMPORTANT: import this module only AFTER setting the bench env
 * (see run.ts) — the app's sign-in reads ENABLE_DEV_CREDENTIALS when built.
 */

import type { AddressInfo } from "node:net";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { PrismaClient } from "@project/db";
import { setTestPrisma, testDb, testPrisma } from "@project/db/testing";
import type { Scenario } from "@project/bench";
import {
  createPrismaTestGlobalSetup,
  openPgliteFromTemplate,
} from "@fitzzero/quickdraw-core/testing/prisma";
import { TEST_TEMPLATE } from "../__tests__/utils/test-template.js";
import { isAllowedOrigin } from "../auth/config.js";
import { createAppAuth, type AppAuth } from "../auth/index.js";
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
  /** The port to listen on; default any free one. The session checks restart on the same one. */
  readonly port?: number;
  /** Also serve the sign-in routes (the guest route among them), for browser pages that sign in by cookie: check:web's. */
  readonly routes?: boolean;
}

type CorsOrigin = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
) => void;

/** An Express app with the sign-in routes, as the API mounts them (CORS, cookies, JSON bodies). */
function routesApp(auth: AppAuth, origin: CorsOrigin): express.Express {
  const app = express();
  app.use(cors({ origin, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: "100kb" }));
  app.use(auth.routes);
  return app;
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

  // bots sign in with development credentials (auth.userId); check:web's
  // pages as guests, by cookie, through the routes
  const auth = createAppAuth({ prisma: testPrisma, serviceNames });
  // Real browsers connect (Tier 2's pages from the web dev server, check:web's
  // from its own): the auth's allowed origins, CLIENT_URL and localhost
  const origin: CorsOrigin = (from, callback) => {
    callback(null, from === undefined || isAllowedOrigin(auth.allowedOrigins, from));
  };
  const app = options.routes ? routesApp(auth, origin) : undefined;
  const server = qd.createServer({
    ...(app === undefined ? {} : { app }),
    services,
    db: testDb,
    logger: silentLogger,
    cors: { origin, credentials: true },
    auth: auth.server,
    // a party is host mode, which runs over peer links (the session checks' party)
    peers: true,
  });
  await ensureGlobalWorld(testDb);
  // anyone in the world's room keeps it running; a bot whose socket left the
  // world leaves the sim (the game service's onRoomLeave), as a player does
  const game = createGameRuntime(testDb, {
    simSeed: scenario.seed,
    tunables: scenario.tunables ?? {},
    onTick: recorder.onTick,
  });
  recorder.seedFood(game.sim.keyframe());
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

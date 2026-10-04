/**
 * The API's test app: every service on quickdraw's own test server
 * (`createTestApp`), over the worker's database through the tracked client
 * (`testDb`), so writes send the frames production sends. A socket from
 * `app.connect({ userId })` acts for that user and gets their grants from
 * the production loader (User.serviceAccess over SERVICE_DEFAULT_ACCESS, see
 * setup.ts); `principalOf` builds the same principal for `app.as(...)`.
 */

import type { Express } from "express";
import type { CollectionSubscribeReply, EntitySubscribeReply } from "@fitzzero/quickdraw-core";
import type { Principal } from "@fitzzero/quickdraw-core/server";
import {
  createTestApp,
  emitWithAck,
  type TestApp,
  type TestConnection,
} from "@fitzzero/quickdraw-core/testing";
import { testDb, testPrisma } from "@project/db/testing";
import { createGrantsLoader } from "../../auth/grants.js";
import { serviceNames, services } from "../../services/index.js";
import { configurePush, type PushServiceOptions } from "../../services/push-subscription/index.js";
// ── quickdraw-game:start ──
import { createGameRuntime, onGameRoomLeave, worldAudience } from "../../services/game/runtime.js";
// ── quickdraw-game:end ──

export type ApiTestApp = TestApp<typeof services>;
export type ApiConnection = TestConnection<typeof services>;

/** A user's grants, as the server loads them for their sockets. */
const loadServiceAccess = createGrantsLoader({ prisma: testPrisma, serviceNames });

export interface StartOptions {
  /** Push transport and online check (default: no sends). */
  readonly push?: PushServiceOptions;
  /** An Express app with the test's own routes, served by the test server. */
  readonly app?: Express;
}

/** Starts the API's services on a test server; close it with `app.close()`. */
export async function startTestApp(options: StartOptions = {}): Promise<ApiTestApp> {
  configurePush(options.push ?? {});
  const app = await createTestApp({
    services,
    db: testDb,
    ...(options.app ? { app: options.app } : {}),
    // N+1 reads, unbounded reads and nested writes in a call fail the test
    strictWarnings: true,
    auth: { loadServiceAccess, serviceAccessSource: { model: "user", column: "serviceAccess" } },
    // ── quickdraw-game:start ──
    // a player whose last socket left the world's room leaves the sim
    onRoomLeave: onGameRoomLeave,
    // ── quickdraw-game:end ──
  });
  // ── quickdraw-game:start ──
  // Fixed seed for deterministic spawns; NPCs off (tests assert exact player
  // sets); the loop is never started (tests drive loop.tickOnce())
  createGameRuntime(testDb, {
    simSeed: 42,
    tunables: { npcCount: 0 },
    hasAudience: worldAudience(app.server),
  });
  // ── quickdraw-game:end ──
  return app;
}

/** The principal the server builds for a user's socket: their id and grants. */
export async function principalOf(userId: string): Promise<Principal> {
  return { userId, kind: "user", serviceAccess: await loadServiceAccess(userId) };
}

/** Subscribes a socket to one row of a service (`qd:sub`): the row, or why it was refused. */
export async function subscribeEntity(
  connection: ApiConnection,
  service: string,
  id: string,
): Promise<EntitySubscribeReply> {
  return await emitWithAck<EntitySubscribeReply>(connection.socket, "qd:sub", {
    s: service,
    ids: [id],
  });
}

/** Opens one scope of a collection over a socket (`qd:col:sub`): its first page, or why it was refused. */
export async function subscribeScope(
  connection: ApiConnection,
  service: string,
  collection: string,
  scope: string,
  page: { readonly limit?: number; readonly cursor?: string } = {},
): Promise<CollectionSubscribeReply> {
  return await emitWithAck<CollectionSubscribeReply>(connection.socket, "qd:col:sub", {
    s: service,
    c: collection,
    scope,
    ...page,
  });
}

import type { Server as SocketIOServer } from "socket.io";
import { createQuickdrawServer } from "@fitzzero/quickdraw-core/server";
import { testPrisma } from "@project/db/testing";
import { buildServices } from "../../services/build-services.js";
import type { PushService, PushServiceOptions } from "../../services/push-subscription/index.js";
// ── quickdraw-game:start ──
import type { GameService } from "../../services/game/index.js";
// ── quickdraw-game:end ──
import { createSocketAuth } from "../../auth/middleware.js";

interface TestServer {
  port: number;
  io: SocketIOServer;
  stop: () => Promise<void>;
  pushService: PushService;
  // ── quickdraw-game:start ──
  /** Loop is NOT started in tests — drive ticks via gameService.loop.tickOnce() */
  gameService: GameService;
  // ── quickdraw-game:end ──
}

interface TestServerOptions {
  /** Push transport/online-check injection (default: push sends disabled). */
  push?: PushServiceOptions;
}

/**
 * Start a test server with all services registered.
 *
 * Uses core's `createQuickdrawServer` with the same auth hooks as production
 * (`createSocketAuth`), pointed at the test database. Dev-credential auth
 * (handshake `auth.userId`) works because setup.ts sets
 * ENABLE_DEV_CREDENTIALS=true; serviceAccess loads through the real
 * `loadServiceAccess` (SERVICE_DEFAULT_ACCESS merge included), so tests
 * exercise the production auth path end to end.
 */
export async function startTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const services = buildServices(testPrisma, {
    push: options.push,
    // ── quickdraw-game:start ──
    // Fixed seed for deterministic spawns; NPCs off (tests assert exact
    // player sets); loop intentionally not started
    game: { simSeed: 42, tunables: { npcCount: 0 } },
    // ── quickdraw-game:end ──
  });
  const { pushService } = services;
  // ── quickdraw-game:start ──
  const { gameService } = services;
  // ── quickdraw-game:end ──

  const { io, httpServer } = createQuickdrawServer({
    // Port 0: the OS assigns an ephemeral port, so parallel workers never collide
    port: 0,
    services,
    auth: createSocketAuth({
      prisma: testPrisma,
      getServiceNames: () => Object.keys(services),
    }),
  });

  await new Promise<void>((resolve) => {
    httpServer.once("listening", () => {
      resolve();
    });
  });

  const address = httpServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server failed to bind a port");
  }

  return {
    port: address.port,
    io,
    pushService,
    // ── quickdraw-game:start ──
    gameService,
    // ── quickdraw-game:end ──
    stop: async () => {
      await io.close();
      await new Promise<void>((resolve) => {
        httpServer.close(() => {
          resolve();
        });
      });
    },
  };
}

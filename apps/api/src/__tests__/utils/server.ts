import type { Server as SocketIOServer } from "socket.io";
import { createQuickdrawServer } from "@fitzzero/quickdraw-core/server";
import { testPrisma } from "@project/db/testing";
import { UserService } from "../../services/user/index.js";
import { ChatService } from "../../services/chat/index.js";
import { MessageService } from "../../services/message/index.js";
import { DocumentService } from "../../services/document/index.js";
// ── quickdraw-game:start ──
import { GameService } from "../../services/game/index.js";
import { DefinitionService } from "../../services/definition/index.js";
// ── quickdraw-game:end ──
import { createSocketAuth } from "../../auth/middleware.js";

interface TestServer {
  port: number;
  io: SocketIOServer;
  stop: () => Promise<void>;
  // ── quickdraw-game:start ──
  /** Loop is NOT started in tests — drive ticks via gameService.loop.tickOnce() */
  gameService: GameService;
  // ── quickdraw-game:end ──
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
export async function startTestServer(): Promise<TestServer> {
  const chatService = new ChatService(testPrisma);
  // ── quickdraw-game:start ──
  // Fixed seed for deterministic spawns; NPCs off (tests assert exact
  // player sets); loop intentionally not started
  const gameService = new GameService(testPrisma, { simSeed: 42, tunables: { npcCount: 0 } });
  // ── quickdraw-game:end ──
  const services = {
    userService: new UserService(testPrisma),
    chatService,
    messageService: new MessageService(testPrisma, chatService),
    documentService: new DocumentService(testPrisma),
    // ── quickdraw-game:start ──
    gameService,
    definitionService: new DefinitionService(testPrisma),
    // ── quickdraw-game:end ──
  };

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

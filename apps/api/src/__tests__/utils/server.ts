import type { Server as SocketIOServer } from "socket.io";
import { createQuickdrawServer } from "@fitzzero/quickdraw-core/server";
import { testPrisma } from "@project/db/testing";
import { UserService } from "../../services/user/index.js";
import { ChatService } from "../../services/chat/index.js";
import { MessageService } from "../../services/message/index.js";
import { DocumentService } from "../../services/document/index.js";
import { createSocketAuth } from "../../auth/middleware.js";

interface TestServer {
  port: number;
  io: SocketIOServer;
  stop: () => Promise<void>;
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
  const services = {
    userService: new UserService(testPrisma),
    chatService,
    messageService: new MessageService(testPrisma, chatService),
    documentService: new DocumentService(testPrisma),
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

import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import {
  ServiceRegistry,
  type QuickdrawSocket,
} from "@fitzzero/quickdraw-core/server";
import { testPrisma } from "@project/db/testing";
import { UserService } from "../../services/user/index.js";
import { ChatService } from "../../services/chat/index.js";
import { MessageService } from "../../services/message/index.js";
import { getAvailablePort } from "./socket.js";

interface TestServer {
  port: number;
  io: SocketIOServer;
  stop: () => Promise<void>;
}

/**
 * Start a test server with all services registered
 */
export async function startTestServer(): Promise<TestServer> {
  const port = getAvailablePort();
  const app = express();
  const httpServer = createServer(app);

  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*" },
  });

  const serviceRegistry = new ServiceRegistry(io);

  // Register services (use testPrisma to match test database)
  serviceRegistry.registerService("userService", new UserService(testPrisma));
  serviceRegistry.registerService("chatService", new ChatService(testPrisma));
  serviceRegistry.registerService(
    "messageService",
    new MessageService(testPrisma)
  );

  // Dev auth middleware - load serviceAccess from database
  io.use(async (socket, next) => {
    const quickdrawSocket = socket as QuickdrawSocket;
    const auth = socket.handshake.auth as Record<string, unknown>;

    if (auth.userId) {
      const userId = String(auth.userId);
      const user = await testPrisma.user.findUnique({
        where: { id: userId },
        select: { id: true, serviceAccess: true },
      });

      if (user) {
        quickdrawSocket.userId = user.id;
        quickdrawSocket.serviceAccess =
          (user.serviceAccess as Record<string, string>) ?? {};
      }
    }

    next();
  });

  // Connection handler
  io.on("connection", (socket) => {
    const quickdrawSocket = socket as QuickdrawSocket;

    if (quickdrawSocket.userId) {
      quickdrawSocket.emit("auth:info", {
        userId: quickdrawSocket.userId,
        serviceAccess: quickdrawSocket.serviceAccess ?? {},
      });
    }

    quickdrawSocket.on("disconnect", () => {
      for (const service of serviceRegistry.getServiceInstances()) {
        try {
          service.unsubscribeSocket(quickdrawSocket);
        } catch {
          // Ignore
        }
      }
    });
  });

  // Wait for server to start
  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => {
      resolve();
    });
  });

  return {
    port,
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

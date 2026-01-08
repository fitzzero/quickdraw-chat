import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { ServiceRegistry } from "../../core/ServiceRegistry";
import type { QuickdrawSocket } from "../../core/BaseService";
import { UserService } from "../../services/user";
import { ChatService } from "../../services/chat";
import { MessageService } from "../../services/message";
import { getAvailablePort } from "./socket";

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

  // Register services
  serviceRegistry.registerService("userService", new UserService());
  serviceRegistry.registerService("chatService", new ChatService());
  serviceRegistry.registerService("messageService", new MessageService());

  // Dev auth middleware
  io.use((socket, next) => {
    const quickdrawSocket = socket as QuickdrawSocket;
    const auth = socket.handshake.auth as Record<string, unknown>;
    
    if (auth.userId) {
      quickdrawSocket.userId = String(auth.userId);
      quickdrawSocket.serviceAccess = {};
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
    httpServer.listen(port, () => resolve());
  });

  return {
    port,
    io,
    stop: () =>
      new Promise<void>((resolve) => {
        io.close();
        httpServer.close(() => resolve());
      }),
  };
}

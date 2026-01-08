import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { config } from "dotenv";

// Load environment variables
config({ path: "../../.env.local" });
config();

import { logger } from "./utils/logger";
import { ServiceRegistry } from "./core/ServiceRegistry";
import type { QuickdrawSocket } from "./core/BaseService";
import { UserService } from "./services/user";
import { ChatService } from "./services/chat";
import { MessageService } from "./services/message";
import { authenticateSocket } from "./auth/middleware";
import { registerDiscordRoutes } from "./auth/discord";

const app = express();
const httpServer = createServer(app);

const PORT = process.env.BACKEND_PORT ?? process.env.PORT ?? 4000;
const SERVER_IP = process.env.SERVER_IP ?? "localhost";
const CLIENT_URL = process.env.CLIENT_URL ?? `http://${SERVER_IP}:3000`;

// Middleware
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API info
app.get("/api", (_req, res) => {
  res.json({
    message: "API is running",
    version: "0.0.1",
  });
});

// Auth routes
registerDiscordRoutes(app);

// Socket.io server
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: CLIENT_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Initialize service registry
const serviceRegistry = new ServiceRegistry(io);

// Register services
const userService = new UserService();
serviceRegistry.registerService("userService", userService);

const chatService = new ChatService();
serviceRegistry.registerService("chatService", chatService);

const messageService = new MessageService();
serviceRegistry.registerService("messageService", messageService);

// Apply authentication middleware
io.use((socket, next) => {
  void authenticateSocket(socket as QuickdrawSocket, next);
});

// Socket.io connection handler
io.on("connection", (socket) => {
  const quickdrawSocket = socket as QuickdrawSocket;
  
  logger.info("Socket connected", {
    socketId: quickdrawSocket.id,
    userId: quickdrawSocket.userId,
  });

  // Send auth info to client
  if (quickdrawSocket.userId) {
    quickdrawSocket.emit("auth:info", {
      userId: quickdrawSocket.userId,
      serviceAccess: quickdrawSocket.serviceAccess ?? {},
    });
  }

  quickdrawSocket.on("disconnect", () => {
    logger.info("Socket disconnected", {
      socketId: quickdrawSocket.id,
      userId: quickdrawSocket.userId,
    });

    // Cleanup subscriptions
    for (const service of serviceRegistry.getServiceInstances()) {
      try {
        service.unsubscribeSocket(quickdrawSocket);
      } catch {
        // Ignore cleanup errors
      }
    }
  });
});

// Start server
httpServer.listen(Number(PORT), "0.0.0.0", () => {
  logger.info(`🚀 API running at http://${SERVER_IP}:${PORT}`);
  logger.info(`   Health check: http://${SERVER_IP}:${PORT}/health`);
  logger.info(`   Registered services: ${serviceRegistry.getServices().join(", ")}`);
});

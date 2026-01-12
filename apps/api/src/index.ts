import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { config } from "dotenv";

// Load environment variables
config({ path: "../../.env.local" });
config();

import { logger } from "./utils/logger.js";
import {
  ServiceRegistry,
  createRateLimiter,
  applyRateLimitMiddleware,
  validateEnv,
  type QuickdrawSocket,
} from "@fitzzero/quickdraw-core/server";
import { prisma } from "@project/db";
import { UserService } from "./services/user/index.js";
import { ChatService } from "./services/chat/index.js";
import { MessageService } from "./services/message/index.js";
import { DocumentService } from "./services/document/index.js";
import { authenticateSocket } from "./auth/middleware.js";
import { registerDiscordRoutes } from "./auth/discord.js";
import { registerGoogleRoutes } from "./auth/google.js";

// Validate required environment variables in production
if (process.env.NODE_ENV === "production") {
  validateEnv({
    required: ["DATABASE_URL", "JWT_SECRET", "CLIENT_URL"],
    productionOnly: true,
  });
}

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
registerGoogleRoutes(app);

// Socket.io server
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: CLIENT_URL,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Rate limiting - prevents abuse and ensures fair resource usage
const rateLimiter = createRateLimiter({
  windowMs: 60000, // 1 minute window
  maxRequests: 100, // 100 requests per minute per socket
  excludeEvents: ["subscribe", "unsubscribe"], // Don't rate limit subscriptions
});

applyRateLimitMiddleware(io, rateLimiter, {
  logger,
  // Use userId if authenticated, otherwise socket.id
  keyGenerator: (socket) => {
    const quickdrawSocket = socket as QuickdrawSocket;
    return quickdrawSocket.userId ?? socket.id;
  },
});

// Initialize service registry
const serviceRegistry = new ServiceRegistry(io, { logger });

// Register services
const userService = new UserService(prisma);
serviceRegistry.registerService("userService", userService);

const chatService = new ChatService(prisma);
serviceRegistry.registerService("chatService", chatService);

const messageService = new MessageService(prisma);
serviceRegistry.registerService("messageService", messageService);

// Document service - demonstrates simpler JSON ACL pattern (no membership table)
const documentService = new DocumentService(prisma);
serviceRegistry.registerService("documentService", documentService);

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

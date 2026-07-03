// oxlint-disable import/max-dependencies -- composition root wires everything
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
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
  validateRedirectOrigin,
  type QuickdrawSocket,
} from "@fitzzero/quickdraw-core/server";
import { createAuthLimiter } from "@fitzzero/quickdraw-core/server/express";
import { prisma } from "@project/db";
import { UserService } from "./services/user/index.js";
import { ChatService } from "./services/chat/index.js";
import { MessageService } from "./services/message/index.js";
import { DocumentService } from "./services/document/index.js";
// ── quickdraw-game:start ──
import { CHANNEL_EVENT_PREFIX } from "@fitzzero/quickdraw-core";
import { DEFINITION_TYPES, SNAKE_TUNABLES_KEY } from "@project/shared";
import { GameService } from "./services/game/index.js";
import { ensureGlobalWorld, loadSnakeTunables } from "./services/game/bootstrap.js";
import { DefinitionService } from "./services/definition/index.js";
import { registerDiscordActivityRoutes } from "./auth/discord-activity.js";
import { registerGuestRoutes } from "./auth/guest.js";
// ── quickdraw-game:end ──
import { authenticateSocket } from "./auth/middleware.js";
import { registerDiscordRoutes } from "./auth/discord.js";
import { registerGoogleRoutes } from "./auth/google.js";
import { registerMockRoutes } from "./auth/mock.js";
import { createAuthRouter } from "./auth/routes.js";

// Validate required environment variables in production
if (process.env.NODE_ENV === "production") {
  validateEnv({
    required: ["DATABASE_URL", "JWT_SECRET", "CLIENT_URL"],
    productionOnly: true,
  });

  // Hard-block dev-only auth bypasses: these flags must never reach a public
  // host. Refusing to boot beats silently ignoring them.
  for (const flag of ["ENABLE_DEV_CREDENTIALS", "ENABLE_MOCK_OAUTH"]) {
    if (process.env[flag] === "true") {
      logger.error(`${flag}=true is not allowed in production — refusing to start`);
      process.exit(1);
    }
  }
}

const app = express();
const httpServer = createServer(app);

const PORT = process.env.BACKEND_PORT ?? process.env.PORT ?? 4000;
const SERVER_IP = process.env.SERVER_IP ?? "localhost";

/**
 * CORS gate shared by Express and Socket.IO. Allows CLIENT_URL,
 * EXTRA_ALLOWED_ORIGINS, GitHub Codespace origins, and localhost in dev.
 * Requests without an Origin header (curl, same-origin) pass through.
 */
function corsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  if (!origin || validateRedirectOrigin(origin)) {
    callback(null, true);
    return;
  }
  callback(new Error(`Origin not allowed: ${origin}`));
}

// Middleware
if (process.env.NODE_ENV === "production") {
  // Behind Cloud Run / a reverse proxy: trust X-Forwarded-* for IPs + cookies
  app.set("trust proxy", 1);
}
app.use(helmet());
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(cookieParser());
app.use(
  express.json({
    // Keep the raw body around for webhook signature verification
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

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

// Auth routes (rate-limited: OAuth flows are a brute-force/abuse target)
app.use(["/auth/google", "/auth/discord", "/auth/mock"], createAuthLimiter());
registerDiscordRoutes(app);
registerGoogleRoutes(app);
registerMockRoutes(app);
// ── quickdraw-game:start ──
// Discord Activity (Embedded App SDK) code exchange — covered by the
// /auth/discord rate limiter above
registerDiscordActivityRoutes(app);
// Guest sessions for anonymous game play
app.use("/auth/guest", createAuthLimiter());
registerGuestRoutes(app);
// ── quickdraw-game:end ──
app.use(createAuthRouter());

// Socket.io server
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

// Rate limiting - prevents abuse and ensures fair resource usage:
// 100 requests per minute per socket; subscriptions are exempt
const rateLimiter = createRateLimiter({
  windowMs: 60000,
  maxRequests: 100,
  excludeEvents: ["subscribe", "unsubscribe"],
  // ── quickdraw-game:start ──
  // Channels enforce their own per-socket token buckets (see game-patterns.md)
  excludePrefixes: [CHANNEL_EVENT_PREFIX],
  // ── quickdraw-game:end ──
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

// ── quickdraw-game:start ──
// Definition service - data-driven game content (public read, admin write)
const definitionService = new DefinitionService(prisma);
serviceRegistry.registerService("definitionService", definitionService);

// Game service - authoritative snake sim; commands are methods, input is a
// channel, snapshots broadcast volatile at tick rate to the world room
await ensureGlobalWorld(prisma);
const gameService = new GameService(prisma, { tunables: await loadSnakeTunables(prisma) });
serviceRegistry.registerService("gameService", gameService);
gameService.startLoop();
process.on("SIGTERM", () => gameService.stopLoop());

// Admin edits to the snake tunables hot-reload the running sim
definitionService.onChanged((definition) => {
  if (definition.type === DEFINITION_TYPES.tunables && definition.key === SNAKE_TUNABLES_KEY) {
    gameService.sim.applyTunables(definition.data);
    logger.info("Applied updated snake tunables from definition edit");
  }
});
// ── quickdraw-game:end ──

// Apply authentication middleware
// Pass getServiceNames for bootstrap admin functionality
io.use((socket, next) => {
  void authenticateSocket(socket as QuickdrawSocket, next, {
    getServiceNames: () => serviceRegistry.getServices(),
  });
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

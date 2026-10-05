// oxlint-disable import/max-dependencies -- composition root wires everything
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { config } from "dotenv";
import { validateEnv } from "@fitzzero/quickdraw-core/server";
import { createAuthLimiter, createCallLimiter } from "@fitzzero/quickdraw-core/server/express";
import { disconnectPrisma, prisma } from "@project/db";
import { createAppAuth } from "./auth/index.js";
import {
  apiUrlProblem,
  encryptionKeyProblem,
  isAllowedOrigin,
  trustProxyFromEnv,
} from "./auth/config.js";
import { deleteExpiredSessions } from "./auth/sessions.js";
import { db } from "./db.js";
import { qd } from "./quickdraw.js";
import { serviceNames, services } from "./services/index.js";
import { configurePush } from "./services/push-subscription/index.js";
import { registerPushRoutes } from "./services/push-subscription/rest.js";
import { logger } from "./utils/logger.js";
// ── quickdraw-game:start ──
import { DEFINITION_TYPES, SNAKE_TUNABLES_KEY } from "@project/shared";
import { registerDiscordActivityRoutes } from "./auth/discord-activity.js";
import { onChanged } from "./services/definition/index.js";
import {
  ensureGlobalWorld,
  loadSnakeTunables,
  snakeTunablesOf,
} from "./services/game/bootstrap.js";
import { createGameRuntime } from "./services/game/runtime.js";
// ── quickdraw-game:end ──

// Load environment variables (scripts/load-env.sh sets them for `bun run dev`;
// these are the fallback for a bare `node dist/index.js`). Every module reads
// the environment when it is called, never when it is imported.
config({ path: process.env.DOTENV_CONFIG_PATH ?? "../../.env.local" });
config();

// Validate required environment variables in production
if (process.env.NODE_ENV === "production") {
  validateEnv({
    // ENCRYPTION_KEY: stored OAuth tokens are only encrypted at rest when it
    // is set — a public deploy without it would persist them plaintext.
    // API_URL: the OAuth redirect URIs are {API_URL}/auth/{provider}/callback.
    required: ["DATABASE_URL", "JWT_SECRET", "CLIENT_URL", "API_URL", "ENCRYPTION_KEY"],
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

// A set ENCRYPTION_KEY that is not 64 hex characters would fail every
// sign-in at its first token encryption: refuse to boot instead
const encryptionKeyError = encryptionKeyProblem(process.env.ENCRYPTION_KEY);
if (encryptionKeyError !== null) {
  logger.error(`${encryptionKeyError} — refusing to start`);
  process.exit(1);
}

// A web app on another machine (CLIENT_URL or EXTRA_ALLOWED_ORIGINS off
// localhost) needs API_URL in every NODE_ENV: the localhost fallback would
// send its sign-ins to http://localhost:<port>. Refuse to boot instead.
const apiUrlError = apiUrlProblem();
if (apiUrlError !== null) {
  logger.error(`${apiUrlError} — refusing to start`);
  process.exit(1);
}

// How many proxies in front to believe for the client's address (the rate
// limits) and protocol: TRUST_PROXY, else 1 in production or behind an https
// API_URL, else none
const trustProxy = trustProxyFromEnv();
if ("problem" in trustProxy) {
  logger.error(`${trustProxy.problem} — refusing to start`);
  process.exit(1);
}
if (trustProxy.source === "API_URL") {
  logger.info(
    "TRUST_PROXY is not set: trusting 1 proxy, since API_URL is https (set TRUST_PROXY to change it)",
  );
}

const PORT = Number(process.env.BACKEND_PORT ?? process.env.PORT ?? 4000);
const SERVER_IP = process.env.SERVER_IP ?? "localhost";

const app = express();

// Sign-in: the auth routes kit over the Session table. `onRevoke` ends the
// sockets of a signed-out session; it is called only once the server below exists.
const auth = createAppAuth({
  prisma,
  serviceNames,
  onRevoke: (userId, sessionId) =>
    server.access.disconnectUser(userId, sessionId === null ? {} : { sessionId }),
});

/**
 * CORS for Express and Socket.IO alike: the auth's allowed origins (CLIENT_URL,
 * EXTRA_ALLOWED_ORIGINS, and Codespaces and localhost outside production).
 * Requests without an Origin header (curl, same-origin) pass through.
 */
function corsOrigin(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  callback(null, origin === undefined || isAllowedOrigin(auth.allowedOrigins, origin));
}

// Middleware
// Behind Cloud Run, a reverse proxy or a tunnel, the X-Forwarded-* headers of
// the proxies trusted above give the client's IP and protocol (none locally)
app.set("trust proxy", trustProxy.value);
app.use(helmet());
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(cookieParser());
app.use(
  express.json({
    // REST here is auth-only (tiny payloads) — raise per-route if a fork
    // adds large webhook/upload bodies
    limit: "100kb",
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
  res.json({ message: "API is running", version: "0.0.1" });
});

// /auth/{google,discord,mock}/start and /callback, /auth/providers (the
// sign-ins served now, for the login page), /auth/me, /auth/logout and
// /auth/logout-all (each rate-limited by the kit)
app.use(auth.routes);
// ── quickdraw-game:start ──
// (the kit serves the guest sign-in there too, POST /auth/guest)
// Discord Activity (Embedded App SDK) code exchange, on the kit's sessions
app.use("/auth/discord/activity", createAuthLimiter());
registerDiscordActivityRoutes(app, { keys: auth.keys, db: prisma });
// ── quickdraw-game:end ──

// Push sends: web-push from the VAPID keys (none without them); chat pushes
// skip members with a live socket (quickdraw's presence)
configurePush();

// ── quickdraw-game:start ──
// The global world and its chat, made once (tracked writes in a unit of work
// of their own: before the server exists, they reach no one)
await ensureGlobalWorld(db);
// ── quickdraw-game:end ──

// Every service on Socket.IO (protocol 5) and HTTP (POST /qd/{service}/{method}),
// on this Express app. The socket rate limiter is the default: 600 events a
// minute per socket, subscriptions and channels not counted.
const server = qd.createServer({
  app,
  services,
  db,
  logger,
  cors: { origin: corsOrigin, credentials: true },
  auth: auth.server,
  // the HTTP transport has no limit of its own
  http: { rateLimit: createCallLimiter() },
});

// Service-worker resubscribe endpoint (REST: SWs have no socket) — rare,
// authenticated traffic, so the auth limiter budget fits
app.use("/api/push", createAuthLimiter());
registerPushRoutes(app, auth.keys);

// ── quickdraw-game:start ──
// The authoritative snake sim, with the stored tunables; anyone in the
// world's room (spectators too) keeps it running
const game = createGameRuntime(db, { tunables: await loadSnakeTunables(prisma) });
// The loop ticks the sim: snapshots on the world stream, deaths and the
// leaderboard to the world's room
game.loop.start();

// Admin edits to the snake tunables hot-reload the running sim
onChanged((definition) => {
  if (definition.type === DEFINITION_TYPES.tunables && definition.key === SNAKE_TUNABLES_KEY) {
    game.sim.applyTunables(snakeTunablesOf(definition.data));
    logger.info("Applied updated snake tunables from definition edit");
  }
});
// ── quickdraw-game:end ──

// Expired-session cleanup: expired Session rows are already refused at sign-in;
// this hourly sweep is hygiene so the table doesn't grow unbounded. A plain
// timer.
// ── quickdraw-game:start ──
// Deliberately not the game loop: no database in the tick path
// (game-patterns.md).
// ── quickdraw-game:end ──
const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
async function cleanupExpiredSessions(): Promise<void> {
  try {
    const count = await deleteExpiredSessions(prisma);
    if (count > 0) logger.info("Deleted expired sessions", { count });
  } catch (error) {
    logger.error("Session cleanup failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
void cleanupExpiredSessions();
const sessionCleanupTimer = setInterval(
  () => void cleanupExpiredSessions(),
  SESSION_CLEANUP_INTERVAL_MS,
);
sessionCleanupTimer.unref();

/** Graceful shutdown: stop the timers, close the server (calls in flight finish), then the pool. */
async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal}: shutting down`);
  clearInterval(sessionCleanupTimer);
  // ── quickdraw-game:start ──
  game.loop.stop();
  // ── quickdraw-game:end ──
  await server.close();
  await disconnectPrisma();
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

// Start server
server.httpServer.listen(PORT, "0.0.0.0", () => {
  logger.info(`🚀 API running at http://${SERVER_IP}:${PORT}`);
  logger.info(`   Health check: http://${SERVER_IP}:${PORT}/health`);
  logger.info(`   Registered services: ${serviceNames().join(", ")}`);
});

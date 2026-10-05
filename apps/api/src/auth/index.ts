// The app's sign-in, on the auth routes kit: Google, Discord, the development
// mock and guests as one Express middleware over the Session table, the
// `authenticate` that checks those sessions on every handshake and HTTP call
// (plus development credentials), and the grants loader. One function builds
// it for a database, so the server, the tests and the netcode bench sign in
// the same way.

import type { ServerAuth } from "@fitzzero/quickdraw-core/server";
import {
  createAuthRoutes,
  discord,
  google,
  mock,
  socketAuth,
  type AllowedOrigin,
  type AuthProvider,
  type AuthRoutes,
  type SessionKeys,
} from "@fitzzero/quickdraw-core/server/auth";
import type { PrismaClient } from "@project/db";
import { logger } from "../utils/logger.js";
import { allowedOriginsFromEnv, apiUrl, jwtSecretFromEnv } from "./config.js";
import { devCredentials } from "./dev-credentials.js";
import { createGrantsLoader } from "./grants.js";
import { prismaSessions } from "./sessions.js";
import { listMockUsers, upsertOAuthUser } from "./users.js";
// ── quickdraw-game:start ──
import { guestProvider } from "./guest.js";
// ── quickdraw-game:end ──

export interface AppAuthOptions {
  /** The untracked client sessions and signing-in users are written through. */
  readonly prisma: PrismaClient;
  /** Every service name, for ADMIN_EMAILS' Admin on all of them. */
  readonly serviceNames: () => readonly string[];
  /**
   * Ends the open sockets of a revoked session (`sessionId`) or of every
   * session of the user (`null`): `server.access.disconnectUser`.
   */
  readonly onRevoke?: (userId: string, sessionId: string | null) => unknown;
  /** The web app's origins. Default: from the environment (`allowedOriginsFromEnv`). */
  readonly allowedOrigins?: readonly AllowedOrigin[];
  /** Signs the session JWTs. Default: JWT_SECRET (a development secret outside production). */
  readonly jwtSecret?: string;
}

export interface AppAuth {
  /** Where sessions are stored, and the secret their JWTs are signed with. */
  readonly keys: SessionKeys;
  /** The web app's origins: CORS, sign-in returns, cookie-authenticated sockets. */
  readonly allowedOrigins: readonly AllowedOrigin[];
  /** The sign-in routes under /auth, as one Express middleware. */
  readonly routes: AuthRoutes;
  /** `createServer`'s `auth`. */
  readonly server: Required<
    Pick<ServerAuth, "authenticate" | "loadServiceAccess" | "serviceAccessSource">
  >;
}

/**
 * The sign-ins: Google and Discord when their credentials are set (`optional`
 * builds nothing without them, and refuses one set without the other), the
 * development mock, and guests.
 */
function providersFor(prisma: PrismaClient): (AuthProvider | undefined)[] {
  const env = process.env;
  const port = env.BACKEND_PORT ?? env.PORT ?? "4000";
  return [
    google.optional({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      // ask Google for a refresh token
      params: { access_type: "offline", prompt: "consent" },
    }),
    discord.optional({ clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET }),
    // Served only while isMockOAuthEnabled(): ENABLE_MOCK_OAUTH=true outside
    // production. Its token and userinfo requests loop back to this process,
    // since API_URL may not be reachable from inside a container.
    mock({ listUsers: () => listMockUsers(prisma), internalUrl: `http://localhost:${port}` }),
    // ── quickdraw-game:start ──
    guestProvider(prisma),
    // ── quickdraw-game:end ──
  ];
}

/** The app's sign-in for one database. */
export function createAppAuth(options: AppAuthOptions): AppAuth {
  const { prisma } = options;
  const keys: SessionKeys = {
    sessions: prismaSessions(prisma),
    jwtSecret: options.jwtSecret ?? jwtSecretFromEnv(),
  };
  const allowedOrigins = options.allowedOrigins ?? allowedOriginsFromEnv();
  const routes = createAuthRoutes({
    providers: providersFor(prisma),
    ...keys,
    onLogin: (profile, provider) => upsertOAuthUser(prisma, profile, provider),
    allowedOrigins,
    publicUrl: apiUrl(),
    successPath: "/auth/callback",
    errorPath: "/auth/login",
    onRevoke: options.onRevoke,
    logger,
  });
  return {
    keys,
    allowedOrigins,
    routes,
    server: {
      // sessions (a token or the cookie), and with ENABLE_DEV_CREDENTIALS a
      // socket naming a user (`auth: { userId }`): a game editor, load-test bots
      authenticate: socketAuth({ ...keys, allowedOrigins, devCredentials: devCredentials(prisma) }),
      loadServiceAccess: createGrantsLoader({ prisma, serviceNames: options.serviceNames }),
      // a tracked write to User.serviceAccess (the admin kit's grants editor)
      // refreshes the user's open sockets
      serviceAccessSource: { model: "user", column: "serviceAccess" },
    },
  };
}

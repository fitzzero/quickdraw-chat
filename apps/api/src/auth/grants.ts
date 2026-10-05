// A user's service-wide grants: `createServer`'s `auth.loadServiceAccess`,
// which runs at each socket handshake and HTTP call, and again when a tracked
// write changes User.serviceAccess (`serviceAccessSource`).

import type { AccessLevel } from "@project/shared";
import type { PrismaClient } from "@project/db";
import { logger } from "../utils/logger.js";

const LEVELS: readonly string[] = ["Public", "Read", "Moderate", "Admin"];

function isAccessLevel(value: unknown): value is AccessLevel {
  return typeof value === "string" && LEVELS.includes(value);
}

/**
 * Parse ADMIN_EMAILS environment variable into a Set of lowercase emails.
 */
function bootstrapAdminEmails(): Set<string> {
  const emailsEnv = process.env.ADMIN_EMAILS;
  if (!emailsEnv) return new Set();
  return new Set(
    emailsEnv
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0),
  );
}

/**
 * Parse SERVICE_DEFAULT_ACCESS ("serviceName:Level,serviceName:Level", e.g.
 * "userService:Read") into the grants every signed-in user starts with.
 */
function defaultServiceAccess(): Record<string, AccessLevel> {
  const defaults: Record<string, AccessLevel> = {};
  for (const entry of (process.env.SERVICE_DEFAULT_ACCESS ?? "").split(",")) {
    const [service, level] = entry.trim().split(":");
    if (service && isAccessLevel(level)) {
      defaults[service] = level;
    }
  }
  return defaults;
}

/** The grants stored on a user (`User.serviceAccess`), keeping only valid levels. */
function storedGrants(stored: unknown): Record<string, AccessLevel> {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(stored).filter((entry): entry is [string, AccessLevel] =>
      isAccessLevel(entry[1]),
    ),
  );
}

export interface GrantsOptions {
  /** The database to read (and, for bootstrap admins, write) users in. */
  readonly prisma: PrismaClient;
  /** Every service name, for ADMIN_EMAILS' Admin on all of them. */
  readonly serviceNames: () => readonly string[];
}

/**
 * Builds `loadServiceAccess`: the user's stored grants over
 * SERVICE_DEFAULT_ACCESS (explicit grants win), or Admin on every service
 * for an ADMIN_EMAILS user whose address a sign-in provider verified
 * (`User.emailVerified`), stored on their row the first time. A user whose
 * ADMIN_EMAILS address no provider verified gets the defaults only, without
 * the grants stored on their row: the row may have claimed the address
 * through an unverified sign-in (any address was stored before 5.0) and
 * received a bootstrap's grants then. A missing user gets the defaults.
 */
export function createGrantsLoader(
  options: GrantsOptions,
): (userId: string) => Promise<Record<string, AccessLevel>> {
  const { prisma, serviceNames } = options;
  return async (userId) => {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true, serviceAccess: true },
    });
    const stored = storedGrants(user?.serviceAccess);
    const merged = { ...defaultServiceAccess(), ...stored };
    if (!user || !bootstrapAdminEmails().has(user.email.toLowerCase())) {
      return merged;
    }
    if (!user.emailVerified) {
      logger.warn("ADMIN_EMAILS address no provider verified: default grants only", { userId });
      return defaultServiceAccess();
    }
    const names = serviceNames();
    if (names.every((name) => stored[name] === "Admin")) {
      return stored;
    }
    const fullAdmin: Record<string, AccessLevel> = Object.fromEntries(
      names.map((name) => [name, "Admin"]),
    );
    logger.info("Bootstrap admin: granting Admin on every service", { userId, services: names });
    // Untracked: this runs inside the handshake that returns these grants
    await prisma.user.update({ where: { id: userId }, data: { serviceAccess: fullAdmin } });
    return fullAdmin;
  };
}

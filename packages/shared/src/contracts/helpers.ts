// Schema helpers shared by the contracts' schemas.

import { z } from "zod";
import type { AccessLevel } from "../types/access.js";

/** A cuid id field with a labeled error ("Invalid chat ID"). */
export function cuidSchema(label: string): z.ZodString {
  return z.string().cuid(`Invalid ${label}`);
}

/** Payload of every by-id method: `{ id }`. */
export const byIdSchema = z.object({
  id: cuidSchema("ID"),
});

/** Standard page/pageSize payload — pair with `parsePagination`. */
export const paginationSchema = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

/** A Web Push endpoint URL. */
export const endpointSchema = z.string().url().max(2048);

/**
 * A browser push subscription: the endpoint plus its encryption keys.
 * Shared by the socket method (`subscribePush`) and the service-worker REST
 * renewal route, which carry the same payload.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
});

// ============================================================================
// Wire shapes the contracts share
// ============================================================================

/**
 * A date as subscribers and callers receive it: quickdraw sends `Date`
 * columns as ISO 8601 strings. Its JSON Schema (`format: "date-time"`) makes
 * the admin kit render the field as a date.
 */
export const isoDateSchema = z.iso.datetime();

/** The four access levels, lowest first: grants in `User.serviceAccess`, access lists. */
export const accessLevelSchema = z.enum([
  "Public",
  "Read",
  "Moderate",
  "Admin",
]) satisfies z.ZodType<AccessLevel>;

/** One entry of a JSON access list (`Document.acl`): `{ userId, level }`. */
export const aceSchema = z.object({
  userId: z.string(),
  level: accessLevelSchema,
});

/** A user's public profile, as other users see it: chat members, message authors. */
export const publicProfileSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
});

/** What most writes answer: the id of the row they wrote. */
export const idResultSchema = z.object({ id: z.string() });

/** What a delete answers: the id of the row it removed. */
export const deletedResultSchema = z.object({
  id: z.string(),
  deleted: z.literal(true),
});

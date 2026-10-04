// Schema helpers moved here from the api package by @fitzzero/quickdraw-codemod,
// for the contracts' schemas. The api package keeps its own copies.

import { z } from "zod";

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

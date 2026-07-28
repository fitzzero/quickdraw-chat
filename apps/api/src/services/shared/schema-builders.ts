import { z } from "zod";

/** A cuid id field with a labeled error ("Invalid chat ID"). */
export function cuidSchema(label: string): z.ZodString {
  return z.string().cuid(`Invalid ${label}`);
}

/** Payload of every by-id method: `{ id }`. */
export const byIdSchema = z.object({
  id: z.string().cuid("Invalid ID"),
});

/** Standard page/pageSize payload — pair with `parsePagination`. */
export const paginationSchema = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

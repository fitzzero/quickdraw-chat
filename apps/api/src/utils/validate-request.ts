import type { Response } from "express";
import { z, type ZodType } from "zod";

export { z };

export type RequestSource = "body" | "query" | "params" | "headers";

/**
 * Validate a request payload against a Zod schema. Responds 400 with field
 * errors and returns undefined on failure; returns the parsed data on success.
 *
 *   const body = validateRequest(schema, req.body, res);
 *   if (!body) return;
 */
export function validateRequest<Output>(
  schema: ZodType<Output>,
  source: unknown,
  res: Response,
  location: RequestSource = "body",
): Output | undefined {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    res.status(400).json({
      error: `Invalid request ${location}`,
      details: z.flattenError(parsed.error).fieldErrors,
    });
    return undefined;
  }
  return parsed.data;
}

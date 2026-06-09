import type { Response } from "express";
import { z, type ZodSchema, type ZodTypeDef } from "zod";

export { z };

export type RequestSource = "body" | "query" | "params" | "headers";

/**
 * Validate a request payload against a Zod schema. Responds 400 with field
 * errors and returns undefined on failure; returns the parsed data on success.
 *
 *   const body = validateRequest(schema, req.body, res);
 *   if (!body) return;
 */
export function validateRequest<Output, Def extends ZodTypeDef = ZodTypeDef, Input = Output>(
  schema: ZodSchema<Output, Def, Input>,
  source: unknown,
  res: Response,
  location: RequestSource = "body",
): Output | undefined {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    res.status(400).json({
      error: `Invalid request ${location}`,
      details: parsed.error.flatten().fieldErrors,
    });
    return undefined;
  }
  return parsed.data;
}

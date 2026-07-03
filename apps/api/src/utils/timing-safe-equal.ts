import crypto from "crypto";

/**
 * Constant-time string comparison for shared secrets (webhook secrets,
 * API tokens, OAuth state). A plain `===` short-circuits on the first
 * differing byte, which leaks how much of a guess was correct.
 *
 * The length check returns early, so only the length is timing-observable —
 * fine for fixed-length secrets.
 */
export function timingSafeStringEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

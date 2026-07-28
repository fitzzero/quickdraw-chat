/**
 * Sanitize API tokens/keys before validating or persisting them (run this
 * before `encrypt()` when a fork stores user-pasted credentials).
 *
 * Clipboard paths (especially macOS) smuggle invisible Unicode into tokens:
 * non-breaking spaces (U+00A0), zero-width spaces/joiners (U+200B-U+200D,
 * U+2060), BOMs (U+FEFF). These then fail upstream auth with confusing 401s.
 */

/**
 * Keep only printable ASCII (0x21-0x7E, `!` to `~`): drops all control
 * characters, whitespace (including \r\n), and non-ASCII Unicode.
 */
export function sanitizeToken(token: string): string {
  if (typeof token !== "string") {
    throw new Error("Token must be a string");
  }

  return token.replace(/[^\x21-\x7E]/g, "");
}

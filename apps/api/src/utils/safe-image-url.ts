/**
 * Accept only https:// URLs for user-supplied avatar/image fields (OAuth
 * profile pictures). Anything else — http:, javascript:, data:, malformed —
 * returns null rather than throwing, so a weird provider payload degrades to
 * "no avatar" instead of a 500 or a stored unsafe URL.
 */
export function safeImageUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

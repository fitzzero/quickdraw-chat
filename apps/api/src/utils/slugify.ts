/**
 * Convert text to a URL-friendly slug (kebab-case).
 * Max 60 chars, min 3 chars (falls back to "item").
 */
export function slugify(text: string): string {
  let slug = text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length > 60) slug = slug.slice(0, 60).replace(/-+$/, "");
  if (slug.length < 3) slug = "item";

  return slug;
}

/**
 * Generate a unique slug, appending -2, -3, etc. on collision.
 * Pass an `exists` lookup scoped however your model needs.
 */
export async function generateUniqueSlug(
  text: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(text);
  if (!(await exists(base))) return base;

  for (let i = 2; i <= 100; i++) {
    const candidate = `${base}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }

  // Extremely unlikely fallback
  return `${base}-${Date.now()}`;
}

/**
 * Pagination helpers shared by service methods and collection snapshots.
 *
 * Two styles live here:
 * - id-cursor pagination (collection snapshots: stable under inserts)
 * - page/pageSize pagination (simple query methods)
 */

export interface ParsedPagination {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
}

/** Clamp page/pageSize payload fields into Prisma skip/take. */
export function parsePagination(
  payload: { page?: number; pageSize?: number },
  options: { defaultPageSize?: number; maxPageSize?: number } = {},
): ParsedPagination {
  const { defaultPageSize = 20, maxPageSize = 100 } = options;
  const page = Math.max(payload.page ?? 1, 1);
  const pageSize = Math.min(Math.max(payload.pageSize ?? defaultPageSize, 1), maxPageSize);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/**
 * Prisma args for id-cursor pagination. Fetches `limit + 1` rows so the
 * caller can tell whether another page exists; pair with
 * {@link sliceCursorPage}.
 */
export function cursorPageArgs(
  cursor: string | null,
  limit: number,
): { take: number; cursor?: { id: string }; skip?: number } {
  return {
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}

/**
 * Split a `limit + 1` result into the visible page and the cursor of the
 * next one (the last row's id, in whatever unique-row space the query
 * paginates over — e.g. membership ids for myChats, message ids for byChat).
 */
export function sliceCursorPage<T extends { id: string }>(
  rows: T[],
  limit: number,
): { page: T[]; nextCursor: string | null } {
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? (page[page.length - 1]?.id ?? null) : null;
  return { page, nextCursor };
}

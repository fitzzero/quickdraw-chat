// Cross-service helpers (guards, pagination, schema builders).
// Candidates for upstreaming into quickdraw-core (RFC 0002 §3.4) — until
// core ships them, every quickdraw app re-writes these.
export { requireAuth } from "./guards.js";
export {
  parsePagination,
  cursorPageArgs,
  sliceCursorPage,
  type ParsedPagination,
} from "./pagination.js";
export { cuidSchema, byIdSchema, paginationSchema } from "./schema-builders.js";

// Shared contracts and types for the fullstack application: used by both the
// server and the client. The contracts are the schema source: every method,
// entity, collection and event is declared in ./contracts.

export type * from "./types.js";
// ── quickdraw-game:start ──
// Value exports (consts + functions) — the type-only barrel above strips values
export * from "./types/game.js";
export * from "./types/definition.js";
export * from "./game/movement.js";
// ── quickdraw-game:end ──
export * from "./contracts/index.js";

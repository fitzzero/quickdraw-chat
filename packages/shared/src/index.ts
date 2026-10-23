// Shared contracts and types for the fullstack application: used by both the
// server and the client. The contracts are the schema source: every method,
// entity, collection and event is declared in ./contracts.

export type * from "./types.js";
// ── quickdraw-game:start ──
// Value exports (consts + functions) — the type-only barrel above strips values
export * from "./types/game.js";
export * from "./types/definition.js";
export * from "./game/movement.js";
export * from "./game/snapshotCodec.js";
export * from "./game/snapshotDecoder.js";
export * from "./game/snapshotEncoder.js";
// The simulation and its loop: the API's world, the bench's ground truth,
// and a party's world in its host (PartyWorld)
export * from "./game/world.js";
export * from "./game/loop.js";
export * from "./game/party.js";
// ── quickdraw-game:end ──
export * from "./contracts/index.js";

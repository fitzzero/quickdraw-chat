// Type modules — one file per concern. A service's methods, entity,
// projections, collections and events are declared in its contract
// (../contracts/<service>.ts); the files here give the shapes the apps use a
// name (`ChatDTO = EntityOf<typeof chatContract>`) and hold the wire types no
// contract owns.

export type * from "./access.js";
export type * from "./user.js";
export type * from "./chat.js";
export type * from "./message.js";
export type * from "./document.js";
export type * from "./push.js";
export type * from "./admin.js";
// ── quickdraw-game:start ──
// (value exports for game.js/definition.js live in ../index.ts — this barrel is type-only)
export type * from "./game.js";
export type * from "./definition.js";
// ── quickdraw-game:end ──

import type { GameServiceChannels } from "./game.js";

// ============================================================================
// Combined Channels Map (client typing for useChannelSend wrappers)
//
// Channels are quickdraw's fire-and-forget counterpart to methods — see
// .claude/rules/game-patterns.md. Register each service's channel map here,
// mirroring how service-methods.ts registers ServiceMethodsMap.
// ============================================================================

export interface ChannelsMap {
  // ── quickdraw-game:start ──
  gameService: GameServiceChannels;
  // ── quickdraw-game:end ──
}

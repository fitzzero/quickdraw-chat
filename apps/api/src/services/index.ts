/**
 * Every service the API serves, in one list: the server, the MCP server, the
 * tests and the bench all take theirs from here, so a new service lands in
 * every root at once. Each service is an object, defined once when its module
 * loads; what 4.x passed to service constructors (the push transport, the
 * game's seed and tunables) is set up by each root (`configurePush`,
 * `createGameRuntime`).
 */

import { chatService } from "./chat/index.js";
import { documentService } from "./document/index.js";
import { messageService } from "./message/index.js";
import { pushService } from "./push-subscription/index.js";
import { userService } from "./user/index.js";
// ── quickdraw-game:start ──
import { definitionService } from "./definition/index.js";
import { gameService } from "./game/index.js";
// ── quickdraw-game:end ──

export const services = [
  userService,
  chatService,
  messageService,
  documentService,
  pushService,
  // ── quickdraw-game:start ──
  gameService,
  definitionService,
  // ── quickdraw-game:end ──
] as const;

/** The service names, as grants and the wire name them. */
export function serviceNames(): string[] {
  return services.map((service) => service.name);
}

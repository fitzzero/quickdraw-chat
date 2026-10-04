import type { EntityOf } from "@fitzzero/quickdraw-core";
import type { chatContract } from "../contracts/chat.js";
import type { documentContract } from "../contracts/document.js";
import type { UserDTO } from "./user.js";
// ── quickdraw-game:start ──
import type { definitionContract } from "../contracts/definition.js";
import type { gameContract } from "../contracts/game.js";
// ── quickdraw-game:end ──

// ============================================================================
// 4.x's entity map
// ============================================================================
// The contracts type every call, entity, item and event now (InputOf,
// OutputOf, EntityOf, ItemOf from @fitzzero/quickdraw-core), so 4.x's
// hand-written ServiceMethodsMap is gone. This map is kept, as views of the
// contracts' entities, only while apps/web still imports it.

/** @deprecated Use `EntityOf<typeof <service>Contract>` (or the DTO alias in ./<service>.ts). */
export interface SubscriptionDataMap {
  userService: UserDTO;
  chatService: EntityOf<typeof chatContract>;
  documentService: EntityOf<typeof documentContract>;
  // ── quickdraw-game:start ──
  gameService: EntityOf<typeof gameContract>;
  definitionService: EntityOf<typeof definitionContract>;
  // ── quickdraw-game:end ──
}

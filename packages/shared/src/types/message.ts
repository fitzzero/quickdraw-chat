import type { ItemOf } from "@fitzzero/quickdraw-core";
import type { messageContract } from "../contracts/message.js";

// ============================================================================
// Message Service Types: named views of the message contract (contracts/message.ts)
// ============================================================================

/**
 * A message with its author's public profile: the item of the `byChat`
 * collection (the `withAuthor` projection), which is what a chat shows.
 */
export type MessageDTO = ItemOf<typeof messageContract, "byChat">;

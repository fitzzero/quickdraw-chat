import type { EntityOf, ItemOf } from "@fitzzero/quickdraw-core";
import type { z } from "zod";
import type { chatContract, chatMemberSchema } from "../contracts/chat.js";

// ============================================================================
// Chat Service Types: named views of the chat contract (contracts/chat.ts)
// ============================================================================

/** Wire shape of a chat: the contract's entity, as subscribers receive it. */
export type ChatDTO = EntityOf<typeof chatContract>;

/**
 * Item of the `myChats` collection: one per chat the scope user is a member
 * of, most recent activity first.
 */
export type ChatListItem = ItemOf<typeof chatContract, "myChats">;

/** One member of a chat, with their level and public profile (`getChatMembers`). */
export type ChatMemberDTO = z.output<typeof chatMemberSchema>;

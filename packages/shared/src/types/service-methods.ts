import type { UserDTO, UserServiceMethods } from "./user.js";
import type { ChatDTO, ChatServiceMethods } from "./chat.js";
import type { MessageServiceMethods } from "./message.js";
import type { DocumentDTO, DocumentServiceMethods } from "./document.js";
// ── quickdraw-game:start ──
import type { GameServiceMethods } from "./game.js";
import type { DefinitionDTO, DefinitionServiceMethods } from "./definition.js";
// ── quickdraw-game:end ──

// ============================================================================
// Combined Service Methods Map (for client typing)
// ============================================================================

export interface ServiceMethodsMap {
  userService: UserServiceMethods;
  chatService: ChatServiceMethods;
  messageService: MessageServiceMethods;
  documentService: DocumentServiceMethods;
  // ── quickdraw-game:start ──
  gameService: GameServiceMethods;
  definitionService: DefinitionServiceMethods;
  // ── quickdraw-game:end ──
}

// ============================================================================
// Subscription Data Map (for useSubscription typing)
// ============================================================================
// One source of truth: each entry is the service's TDto — the wire shape its
// toDto() produces and emitUpdate/subscribe actually send.

export interface SubscriptionDataMap {
  userService: UserDTO;
  chatService: ChatDTO;
  documentService: DocumentDTO;
  // ── quickdraw-game:start ──
  gameService: {
    id: string;
    slug: string;
    name: string;
    chatId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  definitionService: DefinitionDTO;
  // ── quickdraw-game:end ──
}

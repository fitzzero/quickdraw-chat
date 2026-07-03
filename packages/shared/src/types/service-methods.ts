import type { AccessLevel } from "./access.js";
import type { UserServiceMethods } from "./user.js";
import type { ChatServiceMethods } from "./chat.js";
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

export interface SubscriptionDataMap {
  userService: {
    id: string;
    email: string;
    name: string | null;
    image: string | null;
    serviceAccess: Record<string, AccessLevel> | null;
    // ── quickdraw-game:start ──
    /** Anonymous game guest session (see apps/api/src/auth/guest.ts) */
    isGuest?: boolean;
    // ── quickdraw-game:end ──
  };
  chatService: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
  };
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

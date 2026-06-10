import type { AccessLevel } from "./access.js";
import type { UserServiceMethods } from "./user.js";
import type { ChatServiceMethods } from "./chat.js";
import type { MessageServiceMethods } from "./message.js";
import type { DocumentDTO, DocumentServiceMethods } from "./document.js";

// ============================================================================
// Combined Service Methods Map (for client typing)
// ============================================================================

export interface ServiceMethodsMap {
  userService: UserServiceMethods;
  chatService: ChatServiceMethods;
  messageService: MessageServiceMethods;
  documentService: DocumentServiceMethods;
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
  };
  chatService: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
  };
  documentService: DocumentDTO;
}

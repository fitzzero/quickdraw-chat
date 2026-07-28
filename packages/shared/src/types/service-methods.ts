import type { UserDTO, UserServiceMethods } from "./user.js";
import type { ChatDTO, ChatServiceMethods } from "./chat.js";
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
// One source of truth: each entry is the service's TDto — the wire shape its
// toDto() produces and emitUpdate/subscribe actually send.

export interface SubscriptionDataMap {
  userService: UserDTO;
  chatService: ChatDTO;
  documentService: DocumentDTO;
}

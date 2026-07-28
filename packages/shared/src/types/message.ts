// ============================================================================
// Message Service Types
// ============================================================================

/**
 * Wire shape of a message (subscription payloads, emitUpdate, and the
 * `byChat` collection item).
 */
export interface MessageDTO {
  id: string;
  chatId: string;
  userId: string;
  content: string;
  role: string;
  createdAt: string;
  user?: {
    id: string;
    name: string | null;
    image: string | null;
  };
}

/**
 * Collections served by messageService. `byChat` is scoped by chat id and
 * unbounded (no membership `ids` in snapshots — history pages in forever).
 */
export type MessageCollections = {
  byChat: { item: MessageDTO };
};

export interface MessageServiceMethods {
  postMessage: {
    payload: {
      chatId: string;
      content: string;
      role?: "user" | "assistant" | "system";
    };
    response: { id: string };
  };
  deleteMessage: {
    payload: { id: string };
    response: { id: string; deleted: true };
  };
}

// ============================================================================
// Message Service Methods
// ============================================================================

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

export interface MessageServiceMethods {
  postMessage: {
    payload: {
      chatId: string;
      content: string;
      role?: "user" | "assistant" | "system";
    };
    response: { id: string };
  };
  listMessages: {
    payload: {
      chatId: string;
      before?: string;
      limit?: number;
    };
    response: MessageDTO[];
  };
  deleteMessage: {
    payload: { id: string };
    response: { id: string; deleted: true };
  };
}

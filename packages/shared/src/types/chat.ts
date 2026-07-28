import type { AccessLevel } from "./access.js";

// ============================================================================
// Chat Service Types
// ============================================================================

/** Wire shape of a chat entity (subscription payloads + emitUpdate). */
export interface ChatDTO {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Item of the `myChats` collection — one row per chat the scope user is a
 * member of. `createdAt` doubles as the activity fallback when a chat has no
 * messages yet, so clients can sort by `lastMessageAt ?? createdAt`.
 */
export interface ChatListItem {
  id: string;
  title: string;
  memberCount: number;
  lastMessageAt: string | null;
  createdAt: string;
}

/**
 * Collections served by chatService. `myChats` is scoped by *user id* —
 * scopes are not always parent entities — and fans out: one chat row appears
 * in every member's scope.
 */
export type ChatCollections = {
  myChats: { item: ChatListItem };
};

export interface ChatMemberDTO {
  id: string;
  userId: string;
  level: AccessLevel;
  user: {
    id: string;
    name: string | null;
    image: string | null;
  };
}

export interface ChatServiceMethods {
  createChat: {
    payload: {
      title: string;
      members?: { userId: string; level: AccessLevel }[];
    };
    response: { id: string };
  };
  updateTitle: {
    payload: { id: string; title: string };
    response: { id: string; title: string } | null;
  };
  getChatMembers: {
    payload: { chatId: string };
    response: ChatMemberDTO[];
  };
  inviteUser: {
    payload: {
      id: string;
      userId: string;
      level: AccessLevel;
    };
    response: { id: string };
  };
  inviteByName: {
    payload: {
      chatId: string;
      userName: string;
      level: AccessLevel;
    };
    response: { id: string } | { error: "user_not_found" };
  };
  removeUser: {
    payload: { id: string; userId: string };
    response: { id: string };
  };
  leaveChat: {
    payload: { id: string };
    response: { id: string };
  };
  deleteChat: {
    payload: { id: string };
    response: { id: string; deleted: true };
  };
}

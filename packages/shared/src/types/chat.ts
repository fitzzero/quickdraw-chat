import type { AccessLevel } from "./access.js";

// ============================================================================
// Chat Service Methods
// ============================================================================

export interface ChatListItem {
  id: string;
  title: string;
  memberCount: number;
  lastMessageAt: string | null;
}

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
  listMyChats: {
    payload: { page?: number; pageSize?: number };
    response: ChatListItem[];
  };
  deleteChat: {
    payload: { id: string };
    response: { id: string; deleted: true };
  };
}

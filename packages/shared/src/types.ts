// Re-export Prisma types for convenience
// Note: The actual types come from @project/db, but we define service method types here

import type { z } from "zod";

// ============================================================================
// Access Control Types
// ============================================================================

export type AccessLevel = "Public" | "Read" | "Moderate" | "Admin";

export type ACE = {
  userId: string;
  level: AccessLevel;
};

export type ACL = ACE[];

// ============================================================================
// Service Response Types
// ============================================================================

export type ServiceResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string; code?: number };

// ============================================================================
// User Service Methods
// ============================================================================

export type UserServiceMethods = {
  updateUser: {
    payload: {
      id: string;
      data: {
        name?: string | null;
        image?: string | null;
      };
    };
    response: {
      id: string;
      email: string;
      name: string | null;
      image: string | null;
    };
  };
  getMe: {
    payload: Record<string, never>;
    response: {
      id: string;
      email: string;
      name: string | null;
      image: string | null;
      serviceAccess: Record<string, AccessLevel> | null;
    } | null;
  };
};

// ============================================================================
// Chat Service Methods
// ============================================================================

export type ChatListItem = {
  id: string;
  title: string;
  memberCount: number;
  lastMessageAt: string | null;
};

export type ChatServiceMethods = {
  createChat: {
    payload: {
      title: string;
      members?: Array<{ userId: string; level: AccessLevel }>;
    };
    response: { id: string };
  };
  updateTitle: {
    payload: { id: string; title: string };
    response: { id: string; title: string } | null;
  };
  inviteUser: {
    payload: {
      id: string;
      userId: string;
      level: AccessLevel;
    };
    response: { id: string };
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
};

// ============================================================================
// Message Service Methods
// ============================================================================

export type MessageDTO = {
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
};

export type MessageServiceMethods = {
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
};

// ============================================================================
// Combined Service Methods Map (for client typing)
// ============================================================================

export type ServiceMethodsMap = {
  userService: UserServiceMethods;
  chatService: ChatServiceMethods;
  messageService: MessageServiceMethods;
};

// ============================================================================
// Subscription Data Map (for useSubscription typing)
// ============================================================================

export type SubscriptionDataMap = {
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
    acl: ACL | null;
    createdAt: string;
    updatedAt: string;
  };
};

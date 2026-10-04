// The contract of chatService, written by @fitzzero/quickdraw-codemod from
// ChatServiceMethods and the defineMethod calls of ChatService
// (apps/api/src/services/chat/index.ts).
// Every marker below says what to check.

import { defineContract, mutation, query, todoSchema } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import type { ChatDTO, ChatMemberDTO } from "../types/chat.js";
import { byIdSchema, cuidSchema } from "./helpers.js";

const createChatSchema = z.object({
  title: z.string().min(1, "Title is required").max(100, "Title must be 100 characters or less"),
  members: z
    .array(
      z.object({
        userId: cuidSchema("user ID"),
        level: z.enum(["Read", "Moderate", "Admin"]),
      }),
    )
    .optional(),
});

const updateTitleSchema = z.object({
  id: cuidSchema("chat ID"),
  title: z.string().min(1, "Title is required").max(100, "Title must be 100 characters or less"),
});

const getChatMembersSchema = z.object({
  chatId: cuidSchema("chat ID"),
});

const inviteUserSchema = z.object({
  id: cuidSchema("chat ID"),
  userId: cuidSchema("user ID"),
  level: z.enum(["Read", "Moderate", "Admin"]),
});

const inviteByNameSchema = z.object({
  chatId: cuidSchema("chat ID"),
  userName: z.string().min(1, "Username is required"),
  level: z.enum(["Read", "Moderate", "Admin"]),
});

const removeUserSchema = z.object({
  id: cuidSchema("chat ID"),
  userId: cuidSchema("user ID"),
});

export const chatContract = defineContract("chatService", {
  // quickdraw-migrate: review [contract] the entity is the 4.x DTO ChatDTO: give it a real schema. Its keys are the fields subscribers receive, read from model "chat": drop any that is not a column, or give it a projection select and map
  entity: todoSchema<ChatDTO>({ keys: ["id", "title", "createdAt", "updatedAt"] }),
  methods: {
    // quickdraw-migrate: review [contract] mutation, chosen from its name; output: todoSchema of the 4.x response type
    createChat: mutation({ input: createChatSchema, output: todoSchema<{ id: string }>() }),
    // quickdraw-migrate: review [contract] mutation, chosen from its name; output: todoSchema of the 4.x response type
    updateTitle: mutation({
      input: updateTitleSchema,
      output: todoSchema<{ id: string; title: string } | null>(),
    }),
    // quickdraw-migrate: review [contract] mutation, chosen from its name; output: todoSchema of the 4.x response type
    deleteChat: mutation({
      input: byIdSchema,
      output: todoSchema<{ id: string; deleted: true }>(),
    }),
    // quickdraw-migrate: review [contract] query, chosen from its name; output: todoSchema of the 4.x response type
    getChatMembers: query({ input: getChatMembersSchema, output: todoSchema<ChatMemberDTO[]>() }),
    // quickdraw-migrate: review [contract] mutation, chosen from its name; output: todoSchema of the 4.x response type
    inviteUser: mutation({ input: inviteUserSchema, output: todoSchema<{ id: string }>() }),
    // quickdraw-migrate: review [contract] mutation, chosen from its name; output: todoSchema of the 4.x response type
    inviteByName: mutation({
      input: inviteByNameSchema,
      output: todoSchema<{ id: string } | { error: "user_not_found" }>(),
    }),
    // quickdraw-migrate: review [contract] mutation, chosen from its name; output: todoSchema of the 4.x response type
    removeUser: mutation({ input: removeUserSchema, output: todoSchema<{ id: string }>() }),
    // quickdraw-migrate: review [contract] mutation, chosen from its name; output: todoSchema of the 4.x response type
    leaveChat: mutation({ input: byIdSchema, output: todoSchema<{ id: string }>() }),
  },
});

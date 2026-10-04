// The contract of messageService, written by @fitzzero/quickdraw-codemod from
// MessageServiceMethods and the defineMethod calls of MessageService
// (apps/api/src/services/message/index.ts).
// Every marker below says what to check.

import { defineContract, mutation, todoSchema } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import type { MessageDTO } from "../types/message.js";
import { byIdSchema, cuidSchema } from "./helpers.js";

const postMessageSchema = z.object({
  chatId: cuidSchema("chat ID"),
  content: z
    .string()
    .min(1, "Content is required")
    .max(10000, "Content must be 10000 characters or less"),
  role: z.enum(["user", "assistant", "system"]).optional(),
});

export const messageContract = defineContract("messageService", {
  // quickdraw-migrate: review [contract] the entity is the 4.x DTO MessageDTO: give it a real schema. Its keys are the fields subscribers receive, read from model "message": drop any that is not a column, or give it a projection select and map
  entity: todoSchema<MessageDTO>({
    keys: ["id", "chatId", "userId", "content", "role", "createdAt", "user"],
  }),
  methods: {
    // quickdraw-migrate: review [contract] mutation, chosen from its name; output: todoSchema of the 4.x response type
    postMessage: mutation({ input: postMessageSchema, output: todoSchema<{ id: string }>() }),
    // quickdraw-migrate: review [contract] mutation, chosen from its name; output: todoSchema of the 4.x response type
    deleteMessage: mutation({
      input: byIdSchema,
      output: todoSchema<{ id: string; deleted: true }>(),
    }),
  },
});

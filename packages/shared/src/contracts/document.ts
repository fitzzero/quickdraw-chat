// The contract of documentService, written by @fitzzero/quickdraw-codemod from
// DocumentServiceMethods and the defineMethod calls of DocumentService
// (apps/api/src/services/document/index.ts).
// Every marker below says what to check.

import {
  defineContract,
  listOf,
  mutation,
  nullable,
  query,
  todoSchema,
} from "@fitzzero/quickdraw-core";
import { z } from "zod";
import type { DocumentDTO } from "../types/document.js";
import { byIdSchema, cuidSchema, paginationSchema } from "./helpers.js";

const createDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().max(100000).optional(),
});

const updateDocumentSchema = z.object({
  id: cuidSchema("document ID"),
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(100000).optional(),
});

const shareDocumentSchema = z.object({
  id: cuidSchema("document ID"),
  userId: cuidSchema("user ID"),
  level: z.enum(["Public", "Read", "Moderate", "Admin"]),
});

const unshareDocumentSchema = z.object({
  id: cuidSchema("document ID"),
  userId: cuidSchema("user ID"),
});

export const documentContract = defineContract("documentService", {
  // quickdraw-migrate: review [contract] the entity is the 4.x DTO DocumentDTO: give it a real schema. Its keys are the fields subscribers receive, read from model "document": drop any that is not a column, or give it a projection select and map
  entity: todoSchema<DocumentDTO>({
    keys: ["id", "title", "content", "ownerId", "acl", "createdAt", "updatedAt"],
  }),
  methods: {
    // quickdraw-migrate: review [contract] mutation, chosen from its name; output: todoSchema of the 4.x response type
    createDocument: mutation({ input: createDocumentSchema, output: todoSchema<{ id: string }>() }),
    // quickdraw-migrate: review [contract] query, chosen from its name
    getDocument: query({ input: byIdSchema, output: nullable("entity") }),
    // quickdraw-migrate: review [contract] mutation, chosen from its name
    updateDocument: mutation({ input: updateDocumentSchema, output: nullable("entity") }),
    // quickdraw-migrate: review [contract] mutation, chosen from its name; output: todoSchema of the 4.x response type
    deleteDocument: mutation({
      input: byIdSchema,
      output: todoSchema<{ id: string; deleted: true }>(),
    }),
    // quickdraw-migrate: review [contract] query, chosen from its name
    listMyDocuments: query({ input: paginationSchema, output: listOf("entity") }),
    // quickdraw-migrate: review [contract] mutation, chosen from its name; output: todoSchema of the 4.x response type
    shareDocument: mutation({ input: shareDocumentSchema, output: todoSchema<{ id: string }>() }),
    // quickdraw-migrate: review [contract] mutation, chosen from its name; output: todoSchema of the 4.x response type
    unshareDocument: mutation({
      input: unshareDocumentSchema,
      output: todoSchema<{ id: string }>(),
    }),
  },
});

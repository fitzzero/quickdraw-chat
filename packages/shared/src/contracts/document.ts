// The contract of documentService, written by @fitzzero/quickdraw-codemod from
// DocumentServiceMethods and the defineMethod calls of DocumentService
// (apps/api/src/services/document/index.ts), then completed by hand: real output
// schemas and the entity.

import { defineContract, listOf, mutation, nullable, query } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import {
  aceSchema,
  byIdSchema,
  cuidSchema,
  deletedResultSchema,
  idResultSchema,
  isoDateSchema,
  paginationSchema,
} from "./helpers.js";

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

/**
 * A document row: the JSON access-list pattern. Its owner holds Admin, and
 * `acl` lists everyone else it is shared with (`[{ userId, level }]`); as in
 * 4.x, whoever may read the document receives the list.
 */
export const documentSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  ownerId: z.string(),
  // quickdraw-5.0 finding: a handler cannot return the Prisma row for this entity: Prisma types the Json column `acl` as JsonValue, which RowFor (strings widened to string | Date, nothing else) will not accept for a typed list; the same holds for user.serviceAccess and definition.data, so each such handler needs a cast or a projection map
  acl: z.array(aceSchema).nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const documentContract = defineContract("documentService", {
  entity: documentSchema,
  methods: {
    createDocument: mutation({
      input: createDocumentSchema,
      output: idResultSchema,
      describe: "Creates a document owned by the caller.",
    }),
    getDocument: query({
      input: byIdSchema,
      output: nullable("entity"),
      describe: "Reads one document, or null when there is none with that id.",
    }),
    updateDocument: mutation({
      input: updateDocumentSchema,
      // The row itself, so an edit shows at once (optimistic); a missing
      // document is NOT_FOUND where 4.x answered null.
      output: "entity",
      describe: "Changes a document's title or content.",
    }),
    deleteDocument: mutation({
      input: byIdSchema,
      output: deletedResultSchema,
      describe: "Deletes a document.",
    }),
    listMyDocuments: query({
      input: paginationSchema,
      output: listOf("entity"),
      describe:
        "Lists the documents the caller owns or that are shared with them, most recently updated first.",
    }),
    shareDocument: mutation({
      input: shareDocumentSchema,
      output: idResultSchema,
      describe: "Shares a document with a user at a level, replacing any level they had.",
    }),
    unshareDocument: mutation({
      input: unshareDocumentSchema,
      output: idResultSchema,
      describe: "Takes a user off a document's access list.",
    }),
  },
});

// The contract of documentService, written by @fitzzero/quickdraw-codemod from
// DocumentServiceMethods and the defineMethod calls of DocumentService
// (apps/api/src/services/document/index.ts), then completed by hand: the
// entity and the kits. Documents are the template's JSON access-list example:
// the read/write kit's methods, the sharing kit's (which edit the list), and
// the admin kit's, all decided by one policy on the service
// (`jsonAcl("acl", { owner: "ownerId" })`).

import { admin, crud, defineContract, sharing } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import { aceSchema, isoDateSchema } from "./helpers.js";

const newDocumentSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().max(100000).optional(),
});

/** What `update` may change: every field optional (the kit adds `id`). */
const documentPatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(100000).optional(),
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
    // 4.x's createDocument, getDocument, updateDocument, deleteDocument and
    // listMyDocuments: `list` answers the documents the caller owns or that
    // are shared with them, a page at a time (cursor), sorted by a declared
    // field (`{ field: "updatedAt", direction: "desc" }` for the most recent first)
    ...crud.contract({
      entity: documentSchema,
      get: { describe: "Reads one document." },
      list: { filter: ["ownerId"], sort: ["updatedAt", "title", "createdAt"] },
      create: { input: newDocumentSchema, describe: "Creates a document owned by the caller." },
      update: { input: documentPatchSchema, describe: "Changes a document's title or content." },
      delete: { describe: "Deletes a document." },
    }),
    // 4.x's shareDocument and unshareDocument, on the access list the policy reads
    ...sharing.contract({ mode: "acl", methods: ["share", "unshare", "setLevel", "listShares"] }),
    // The admin screens: every document, for holders of a service-wide Admin grant
    ...admin.contract({
      entity: documentSchema,
      filter: ["ownerId"],
      sort: ["updatedAt", "title", "createdAt"],
    }),
  },
});

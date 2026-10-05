// The contract of documentService. Documents are the template's JSON
// access-list example: the read/write kit's methods, the sharing kit's (which
// edit the list), and the admin kit's, all decided by one policy on the
// service (`jsonAcl("acl", { owner: "ownerId" })`).

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
 * `acl` lists everyone else it is shared with (`[{ userId, level }]`);
 * whoever may read the document receives the list.
 */
export const documentSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  ownerId: z.string(),
  acl: z.array(aceSchema).nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const documentContract = defineContract("documentService", {
  entity: documentSchema,
  methods: {
    // The read/write kit: `list` answers the documents the caller owns or
    // that are shared with them, a page at a time (cursor), sorted by a
    // declared field (`{ field: "updatedAt", direction: "desc" }` for the
    // most recent first)
    ...crud.contract({
      entity: documentSchema,
      get: { describe: "Reads one document." },
      list: { filter: ["ownerId"], sort: ["updatedAt", "title", "createdAt"] },
      create: { input: newDocumentSchema, describe: "Creates a document owned by the caller." },
      update: { input: documentPatchSchema, describe: "Changes a document's title or content." },
      delete: { describe: "Deletes a document." },
    }),
    // The sharing kit, on the access list the policy reads
    ...sharing.contract({ mode: "acl", methods: ["share", "unshare", "setLevel", "listShares"] }),
    // The admin screens: every document, for holders of a service-wide Admin grant
    ...admin.contract({
      entity: documentSchema,
      filter: ["ownerId"],
      sort: ["updatedAt", "title", "createdAt"],
    }),
  },
});

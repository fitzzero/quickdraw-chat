import { admin, crud, jsonAcl, sharing } from "@fitzzero/quickdraw-core/server";
import { documentContract } from "@project/shared";
import { qd } from "../../quickdraw.js";

/**
 * DocumentService demonstrates the JSON access-list pattern: no membership
 * table, a `[{ userId, level }]` list on the row plus Admin for its owner,
 * which one policy reads for every surface (a call, a subscription, the kits'
 * lists). It suits documents with an owner and a few collaborators, where
 * "every document user X may read" is a filter on the list (`list` below)
 * rather than a join.
 *
 * Every method is a kit's: the read/write kit's get, list, create, update
 * and delete; the sharing kit's share, unshare, setLevel and listShares,
 * which edit the list the policy reads (refusing a level above the caller's
 * own, and the owner's); and the admin kit's.
 */
export const documentService = qd.defineService(documentContract, {
  model: "document",
  access: jsonAcl("acl", { owner: "ownerId" }),
  methods: {
    ...crud.handlers(documentContract, {
      access: {
        // the access forms 4.x's methods had, a service grant passing the row check
        get: { service: "Read", entry: "Read" },
        update: { service: "Moderate", entry: "Moderate" },
        delete: { service: "Admin", entry: "Admin" },
        // any signed-in user creates their own documents, and lists the ones
        // they may read (the kit filters the rows by the policy)
        create: "authenticated",
        list: "authenticated",
      },
      // the caller owns what they create; the access list starts empty
      prepare: (input, ctx) => ({
        title: input.title,
        content: input.content ?? "",
        ownerId: ctx.principal.userId,
        acl: [],
      }),
    }),
    // 4.x's share and unshare were { service: "Admin", entry: "Admin" }: the
    // kit's default for a change is { entry: "Admin" }, so the service grant
    // stays named; lists need Read on the document
    ...sharing.handlers(documentContract, {
      access: {
        share: { service: "Admin", entry: "Admin" },
        unshare: { service: "Admin", entry: "Admin" },
        setLevel: { service: "Admin", entry: "Admin" },
        listShares: { service: "Read", entry: "Read" },
      },
    }),
    ...admin.handlers(documentContract, { displayName: "Documents" }),
  },
});

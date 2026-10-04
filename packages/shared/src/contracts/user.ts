// The contract of userService: the user entity and its field tiers, the
// caller's own row, the profile update and the admin kit (which edits grants
// too, `grants: true` in apps/api/src/services/user/index.ts).

import { admin, defineContract, mutation, nullable, query } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import { accessLevelSchema, cuidSchema, isoDateSchema } from "./helpers.js";

const updateUserSchema = z.object({
  id: cuidSchema("user ID"),
  data: z.object({
    name: z.string().min(1).max(50).optional(),
    image: z.string().url("Invalid image URL").optional(),
  }),
});

/**
 * A user row. Any signed-in user may read a profile; `email` and
 * `serviceAccess` reach only readers with Admin on the row (`fields` below):
 * the user themself and holders of a service-wide Admin grant. Readers below
 * that receive the row without them, so the row types make them optional.
 */
export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
  /** Service-wide grants, by service name: `{ "chatService": "Admin" }`. */
  serviceAccess: z.record(z.string(), accessLevelSchema).nullable(),
  // ── quickdraw-game:start ──
  /** An anonymous game guest (see apps/api/src/auth/guest.ts). */
  isGuest: z.boolean(),
  // ── quickdraw-game:end ──
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const userContract = defineContract("userService", {
  entity: userSchema,
  // only the user themself and a service-wide Admin grant receive these
  fields: { email: "Admin", serviceAccess: "Admin" },
  methods: {
    getMe: query({
      input: z.object({}),
      // The caller's own row, or null when there is none. Field tiers apply,
      // so the caller keeps `email` and `serviceAccess` only while the
      // service's policy gives a user Admin on their own row.
      output: nullable("entity"),
      describe: "Reads the caller's own user.",
    }),
    updateUser: mutation({
      input: updateUserSchema,
      output: z.union([
        z.object({ error: z.literal("name_taken") }),
        z.object({
          id: z.string(),
          email: z.string(),
          name: z.string().nullable(),
          image: z.string().nullable(),
        }),
      ]),
      describe:
        'Changes a user\'s name or image; answers { error: "name_taken" } when another user has the name.',
    }),
    // The admin screens: every user, for holders of a service-wide Admin
    // grant; `adminUpdate` also writes `serviceAccess` (the service passes
    // `grants: true`), which replaces the user's grants and reaches their
    // open sockets at once
    ...admin.contract({ entity: userSchema, sort: ["createdAt", "name", "email"] }),
  },
});

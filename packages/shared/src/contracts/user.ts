// The contract of userService, written by @fitzzero/quickdraw-codemod from
// UserServiceMethods and the defineMethod calls of UserService
// (apps/api/src/services/user/index.ts), then completed by hand: real output
// schemas, the entity and its field tiers.

import { defineContract, mutation, nullable, query } from "@fitzzero/quickdraw-core";
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
 * the user themself and holders of a service-wide Admin grant, the readers
 * 4.x called elevated.
 */
export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().nullable(),
  image: z.string().nullable(),
  /** Service-wide grants: `{ "chatService": "Admin" }`. */
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
  // was getProtectedFields() (["email", "serviceAccess"]) with 4.x's elevated
  // readers: the user themself or a service-wide Admin grant
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
  },
});

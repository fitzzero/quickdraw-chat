import { admin, anyOf, everyone, owner } from "@fitzzero/quickdraw-core/server";
import { userContract } from "@project/shared";
import { qd } from "../../quickdraw.js";

/**
 * Users: each user holds Admin on their own row (`owner` on `id`), which
 * gives them their email and grants (the contract's `fields` keep both at
 * Admin), and every signed-in user reads the rest of every profile: their
 * name and image (`everyone("Read")`). Service administrators edit users
 * through the admin kit, grants included (`grants: true`).
 */
export const userService = qd.defineService(userContract, {
  model: "user",
  access: anyOf(owner("id"), everyone("Read")),
  methods: {
    getMe: {
      // the caller's own row: names no row by id
      access: "authenticated",
      handler: ({ ctx, db }) => db.user.findUnique({ where: { id: ctx.principal.userId } }),
    },
    // quickdraw: hand-written because a taken name answers { error: "name_taken" } (the profile form shows it) where the read/write kit's update answers CONFLICT, and it answers the changed profile rather than the entity
    updateUser: {
      // the user themself (Admin on their row) or a service-wide userService
      // Moderate grant (SERVICE_DEFAULT_ACCESS gives every signed-in user
      // Read, which is not enough)
      access: { service: "Moderate", entry: "Moderate" },
      handler: async ({ input, db }) => {
        try {
          return await db.user.update({
            where: { id: input.id },
            data: { name: input.data.name, image: input.data.image },
            select: { id: true, email: true, name: true, image: true },
          });
        } catch (error) {
          // User.name is unique — surface collisions as a typed result
          // (mirrors chatService.inviteByName's { error } pattern)
          if ((error as { code?: string }).code === "P2002") {
            return { error: "name_taken" as const };
          }
          throw error;
        }
      },
    },
    // The admin screens: every user, for holders of a service-wide Admin
    // grant. `grants: true` shows and writes `serviceAccess` through
    // `adminUpdate`, for callers whose own userService grant is Admin only;
    // the tracked write refreshes the user's open sockets (the server names
    // the column in `auth.serviceAccessSource`).
    ...admin.handlers(userContract, {
      displayName: "Users",
      grants: true,
      // edited by the grants editor on the user's admin page (which finds the
      // field by its `kind: "grants"`): neither a column nor a generic form field
      fieldOverrides: { serviceAccess: { showInTable: false, showInForm: false } },
    }),
  },
});

import { admin, anyOf, owner, resolver } from "@fitzzero/quickdraw-core/server";
import { userContract, type AccessLevel } from "@project/shared";
import { qd } from "../../quickdraw.js";

/** A user row as the contract's entity types it: `serviceAccess` is a typed map, not Prisma's JsonValue. */
type UserRow<R extends { serviceAccess: unknown }> = Omit<R, "serviceAccess"> & {
  serviceAccess: Record<string, AccessLevel> | null;
};

/**
 * Narrows a user row's Json `serviceAccess` to the contract's grant map.
 * The column only ever holds grants (written by setServiceAccess, the seed and
 * the ADMIN_EMAILS bootstrap); the contract's output check validates it in
 * development.
 */
// quickdraw-5.0 finding: a handler cannot return a Prisma row whose Json column the entity types (user.serviceAccess, as document.acl): RowFor accepts strings and Dates, not JsonValue for a typed map, so every such handler goes through a cast like this one
function asUserRow<R extends { serviceAccess: unknown }>(row: R): UserRow<R> {
  return row as UserRow<R>;
}

/**
 * Every signed-in user reads every profile at Read (4.x's checkAccess
 * answered true for "Read"): their name and image. The contract's `fields`
 * keep `email` and `serviceAccess` at Admin, which only the user themself
 * (`owner` on `id`) and a service-wide Admin grant have.
 */
// quickdraw-5.0 finding: no policy builder gives every signed-in user a level on every row (public profiles, public posts): the access docs point at `rowless: true`, which covers method calls but not entity subscriptions, so this resolver answers Read for every id by hand
const anyProfile = resolver({
  levelsFor: (_principal, ids) => new Map(ids.map((id) => [id, "Read"])),
  where: (_principal, level) => Promise.resolve(level === "Read" ? {} : "none"),
});

/**
 * Users: each user holds Admin on their own row (`owner` on `id`), which
 * gives them their email and grants; everyone signed in reads the rest of
 * every profile. Service administrators edit users through the admin kit and
 * grants through setServiceAccess.
 */
export const userService = qd.defineService(userContract, {
  model: "user",
  access: anyOf(owner("id"), anyProfile),
  methods: {
    getMe: {
      // the caller's own row: names no row by id (4.x: "Read" without a row id)
      access: "authenticated",
      handler: async ({ ctx, db }) => {
        const user = await db.user.findUnique({ where: { id: ctx.principal.userId } });
        return user === null ? null : asUserRow(user);
      },
    },
    // quickdraw: hand-written because a taken name answers { error: "name_taken" } (the profile form shows it) where the read/write kit's update answers CONFLICT, and it answers the changed profile rather than the entity
    updateUser: {
      // the user themself (Admin on their row) or a service-wide userService
      // Moderate grant; 4.x let any userService grant through, Read included,
      // which SERVICE_DEFAULT_ACCESS gives every signed-in user
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
    setServiceAccess: {
      // service administrators only, as 4.x's adminUpdate of serviceAccess was
      access: { service: "Admin" },
      handler: async ({ input, db }) =>
        asUserRow(
          await db.user.update({
            where: { id: input.id },
            data: { serviceAccess: input.serviceAccess },
          }),
        ),
    },
    ...admin.handlers(userContract, { displayName: "Users" }),
  },
});

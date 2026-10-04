import type { EntityOf } from "@fitzzero/quickdraw-core";
import type { userContract } from "../contracts/user.js";

// ============================================================================
// User Service Types: named views of the user contract (contracts/user.ts)
// ============================================================================

type UserRow = EntityOf<typeof userContract>;

/** The user fields the contract tiers in `fields`: only Admin on the row receives them. */
type TieredUserField = "email" | "serviceAccess";

/**
 * A user as a reader receives it. `email` and `serviceAccess` reach only the
 * user themself and holders of a service-wide Admin grant; everyone else gets
 * the row without them, so they are optional here.
 */
// quickdraw-5.0 finding: EntityOf (and useEntity's data) types a `fields`-tiered key as always present, though readers below its level never receive it; this type makes the tiered keys optional by hand
export type UserDTO = Omit<UserRow, TieredUserField> & Partial<Pick<UserRow, TieredUserField>>;

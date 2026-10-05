import type { EntityOf } from "@fitzzero/quickdraw-core";
import type { userContract } from "../contracts/user.js";

// ============================================================================
// User Service Types: named views of the user contract (contracts/user.ts)
// ============================================================================

/**
 * A user as a reader receives it. `email` and `serviceAccess` reach only the
 * user themself and holders of a service-wide Admin grant (the contract's
 * `fields`), so `EntityOf` types them optional.
 */
export type UserDTO = EntityOf<typeof userContract>;

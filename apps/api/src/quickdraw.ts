import type { AnyContract, MethodName } from "@fitzzero/quickdraw-core";
import {
  initQuickdraw,
  type MethodImplementation,
  type Principal,
} from "@fitzzero/quickdraw-core/server";
import type { contracts } from "@project/shared";
import type { db } from "./db.js";

/**
 * Who calls: a signed-in person (`"user"`: a session, a guest, development
 * credentials), or an agent acting for one (`"agent"`: the MCP server).
 * Every principal carries its kind: one without a kind is refused everywhere.
 */
export interface AppPrincipal extends Principal {
  readonly kind: "user" | "agent";
}

/**
 * A signed-in person's principal, as every sign-in builds it: `socketAuth`'s
 * and `requireSession`'s `loadPrincipal`, and development credentials. It
 * carries no grants, so the server loads them (`auth.loadServiceAccess`).
 */
export function userPrincipal(userId: string): AppPrincipal {
  return { userId, kind: "user" };
}

/** An agent acting for the user `userId`: the MCP server's caller. */
export function agentPrincipal(userId: string): AppPrincipal {
  return { userId, kind: "agent" };
}

// The app's quickdraw instance and its types, stated once: the tracked
// database client, the principal and the contracts. Every service, handler
// and caller is typed from them; import `qd` from here, never call
// initQuickdraw again.
export type AppTypes = {
  readonly db: typeof db;
  readonly principal: AppPrincipal;
  readonly contracts: typeof contracts;
};

// Both kinds may call every service, unless a service or a method narrows
// them (`kinds: ["user"]` where only a person acts: an agent acting for one
// is refused there, whatever its grants)
export const qd = initQuickdraw<AppTypes>({ kinds: ["user", "agent"] });

/**
 * A method written in a module of its own, outside `qd.defineService`, which
 * lists it in `methods`: `export const rename = { access, handler } satisfies
 * MethodOf<typeof taskContract, "rename">`. Any access form but `"public"`;
 * its handler's principal is never null.
 */
export type MethodOf<C extends AnyContract, M extends MethodName<C>> = MethodImplementation<
  AppTypes,
  C,
  M,
  "authenticated"
>;

/** {@link MethodOf} for a method with `"public"` access, whose principal may be null. */
export type PublicMethodOf<C extends AnyContract, M extends MethodName<C>> = MethodImplementation<
  AppTypes,
  C,
  M,
  "public"
>;

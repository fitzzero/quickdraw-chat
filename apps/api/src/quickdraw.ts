import type { AnyContract, MethodName } from "@fitzzero/quickdraw-core";
import { initQuickdraw, type MethodImplementation } from "@fitzzero/quickdraw-core/server";
import type { contracts } from "@project/shared";
import type { db } from "./db.js";

// Written by @fitzzero/quickdraw-codemod: the app's types, stated once. Every
// service, handler and caller is typed from them.
export type AppTypes = { readonly db: typeof db; readonly contracts: typeof contracts };

export const qd = initQuickdraw<AppTypes>();

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

import type { ServiceMethodContext } from "@fitzzero/quickdraw-core";

/**
 * Assert the caller is authenticated and narrow `ctx.userId` to string.
 * Use at the top of any method that needs an identity:
 *
 * ```typescript
 * async (payload, ctx) => {
 *   requireAuth(ctx);
 *   // ctx.userId is string from here on
 * }
 * ```
 */
export function requireAuth(
  ctx: ServiceMethodContext,
): asserts ctx is ServiceMethodContext & { userId: string } {
  if (!ctx.userId) {
    throw new Error("Authentication required");
  }
}

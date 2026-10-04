"use client";

// quickdraw-migrate: review [v4-api] 4.x API useServiceQuery (removed): lint's no-v4-api names each replacement
import { useServiceQuery } from "@fitzzero/quickdraw-core/client";
import type { AdminServiceMeta } from "@project/shared";

const EMPTY_PAYLOAD: Record<string, never> = {};

/**
 * Hook to fetch admin metadata for a specific service.
 *
 * Uses the generic quickdraw-core `useServiceQuery` because admin methods use
 * dynamic event names (`${serviceName}:adminMeta`) that are not part of the
 * typed `ServiceMethodsMap`.
 *
 * @param serviceName - The service to fetch metadata for
 * @returns Object containing the metadata, loading state, and error
 *
 * @example
 * ```tsx
 * const { meta, isLoading, error } = useAdminMeta("chatService");
 *
 * if (meta) {
 *   // Use meta.fields to render table columns
 * }
 * ```
 */
export function useAdminMeta(serviceName: string): {
  meta: AdminServiceMeta | null;
  isLoading: boolean;
  error: string | null;
} {
  // quickdraw-migrate: review [client] this 4.x hook call was not converted: it names the service or method at run time. Call the typed client's member (qd.<service>.<method>) instead
  const { data, isError, error } = useServiceQuery<Record<string, never>, AdminServiceMeta>(
    serviceName,
    "adminMeta",
    EMPTY_PAYLOAD,
    { enabled: !!serviceName },
  );

  return {
    meta: data ?? null,
    // No data and no error means the query hasn't settled yet
    // (covers the initial socket-connection phase as well)
    isLoading: data === undefined && !isError,
    error,
  };
}

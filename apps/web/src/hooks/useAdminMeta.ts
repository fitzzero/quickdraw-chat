"use client";

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

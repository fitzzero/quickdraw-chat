"use client";

import * as React from "react";
import { useSocket } from "../providers";
import type { AdminServiceMeta, ServiceResponse } from "@project/shared";

/**
 * Hook to fetch admin metadata for a specific service.
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
  const { socket, isConnected } = useSocket();
  const [meta, setMeta] = React.useState<AdminServiceMeta | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!socket || !isConnected || !serviceName) {
      return;
    }

    setIsLoading(true);
    setError(null);

    socket.emit(
      `${serviceName}:adminMeta`,
      {},
      (response: ServiceResponse<AdminServiceMeta>) => {
        if (response.success) {
          setMeta(response.data);
          setError(null);
        } else {
          setMeta(null);
          setError(response.error);
        }
        setIsLoading(false);
      }
    );
  }, [socket, isConnected, serviceName]);

  return {
    meta,
    isLoading,
    error,
  };
}

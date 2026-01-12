"use client";

import * as React from "react";
import { useSocket } from "../providers";
import type { AdminServiceMeta, ServiceResponse } from "@project/shared";

/**
 * Response from adminList method.
 */
export interface AdminListResponse<T = Record<string, unknown>> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Hook to fetch paginated admin list data for a service.
 *
 * @param serviceName - The service to fetch data from
 * @param meta - Service metadata (used to determine if list is available)
 * @returns Object containing data, loading state, pagination controls, and sorting
 *
 * @example
 * ```tsx
 * const {
 *   data,
 *   isLoading,
 *   page,
 *   setPage,
 *   sortField,
 *   sortDirection,
 *   setSort,
 *   refresh,
 * } = useAdminList("chatService", meta);
 * ```
 */
export function useAdminList(
  serviceName: string,
  meta: AdminServiceMeta | null
): {
  data: AdminListResponse | null;
  isLoading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
  sortField: string | null;
  sortDirection: "asc" | "desc";
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setSort: (field: string | null, direction: "asc" | "desc") => void;
  refresh: () => void;
} {
  const { socket, isConnected } = useSocket();
  const [data, setData] = React.useState<AdminListResponse | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [sortField, setSortField] = React.useState<string | null>("createdAt");
  const [sortDirection, setSortDirection] = React.useState<"asc" | "desc">("desc");
  const [refreshKey, setRefreshKey] = React.useState(0);

  // Fetch data when params change
  const fetchData = React.useCallback(() => {
    if (!socket || !isConnected || !serviceName || !meta) {
      return;
    }

    setIsLoading(true);
    setError(null);

    const payload: Record<string, unknown> = {
      page,
      pageSize,
    };

    if (sortField) {
      payload.orderBy = { [sortField]: sortDirection };
    }

    socket.emit(
      `${serviceName}:adminList`,
      payload,
      (response: ServiceResponse<AdminListResponse>) => {
        if (response.success) {
          setData(response.data);
          setError(null);
        } else {
          setData(null);
          setError(response.error);
        }
        setIsLoading(false);
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, isConnected, serviceName, meta, page, pageSize, sortField, sortDirection, refreshKey]);

  React.useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset to page 1 when sort changes
  const handleSetSort = React.useCallback(
    (field: string | null, direction: "asc" | "desc") => {
      setSortField(field);
      setSortDirection(direction);
      setPage(1);
    },
    []
  );

  // Refresh function
  const refresh = React.useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return {
    data,
    isLoading,
    error,
    page,
    pageSize,
    sortField,
    sortDirection,
    setPage,
    setPageSize,
    setSort: handleSetSort,
    refresh,
  };
}

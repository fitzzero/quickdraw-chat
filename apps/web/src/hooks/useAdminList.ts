"use client";

import * as React from "react";
import { useServiceQuery } from "@fitzzero/quickdraw-core/client";
import type { AdminServiceMeta } from "@project/shared";

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
 * Uses the generic quickdraw-core `useServiceQuery` because admin methods use
 * dynamic event names (`${serviceName}:adminList`) that are not part of the
 * typed `ServiceMethodsMap`.
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
  meta: AdminServiceMeta | null,
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
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [sortField, setSortField] = React.useState<string | null>("createdAt");
  const [sortDirection, setSortDirection] = React.useState<"asc" | "desc">("desc");

  const payload = React.useMemo<Record<string, unknown>>(() => {
    const base: Record<string, unknown> = { page, pageSize };
    if (sortField) {
      base.orderBy = { [sortField]: sortDirection };
    }
    return base;
  }, [page, pageSize, sortField, sortDirection]);

  const { data, isFetching, isError, error, refetch } = useServiceQuery<
    Record<string, unknown>,
    AdminListResponse
  >(serviceName, "adminList", payload, {
    enabled: !!serviceName && !!meta,
    // Always fetch fresh data when pagination/sorting changes
    staleTime: 0,
  });

  // Keep the last successful page so rows stay visible while the next page loads
  const [lastData, setLastData] = React.useState<AdminListResponse | null>(null);
  React.useEffect(() => {
    if (data) {
      setLastData(data);
    }
  }, [data]);

  const resolvedData = isError ? null : (data ?? lastData);

  // Reset to page 1 when sort changes
  const handleSetSort = React.useCallback((field: string | null, direction: "asc" | "desc") => {
    setSortField(field);
    setSortDirection(direction);
    setPage(1);
  }, []);

  // Refresh function (forces a refetch of the current page)
  const refresh = React.useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    data: resolvedData,
    isLoading: isFetching || (resolvedData === null && !isError),
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

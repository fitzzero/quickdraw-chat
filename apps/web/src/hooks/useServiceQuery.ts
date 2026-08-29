"use client";

import { useServiceQuery as useQuickdrawServiceQuery } from "@fitzzero/quickdraw-core/client";
import type { ServiceMethodsMap } from "@project/shared";
import type { GetPayload, GetResponse } from "./service-types";

interface UseServiceQueryOptions<TResponse> {
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
  skipCache?: boolean;
  /**
   * Socket events that auto-refetch this query (debounced by core) — for
   * genuinely query-shaped reads (joins, aggregates). Live *row lists*
   * should be server collections consumed with useCollection instead.
   */
  invalidateOn?: string[];
  onSuccess?: (data: TResponse) => void;
  onError?: (error: string) => void;
}

/**
 * Typed wrapper around quickdraw-core's useServiceQuery hook.
 * Use this hook for READ operations (get, list, search, find).
 * Provides automatic caching, request deduplication, and stale time management.
 *
 * @example
 * ```tsx
 * // Fetch members with automatic caching
 * const { data: members, isLoading, refetch } = useServiceQuery(
 *   "chatService",
 *   "getChatMembers",
 *   { chatId },
 *   { enabled: !!chatId }
 * );
 *
 * // Conditional fetch
 * const { data: user } = useServiceQuery(
 *   "userService",
 *   "getUser",
 *   { id: userId },
 *   { enabled: !!userId, staleTime: 60000 }
 * );
 * ```
 */
export function useServiceQuery<
  TService extends keyof ServiceMethodsMap,
  TMethod extends keyof ServiceMethodsMap[TService] & string,
>(
  serviceName: TService,
  methodName: TMethod,
  payload: GetPayload<TService, TMethod>,
  options?: UseServiceQueryOptions<GetResponse<TService, TMethod>>,
) {
  return useQuickdrawServiceQuery<GetPayload<TService, TMethod>, GetResponse<TService, TMethod>>(
    serviceName as string,
    methodName,
    payload,
    options,
  );
}

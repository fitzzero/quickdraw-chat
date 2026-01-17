"use client";

import { useServiceQuery as useQuickdrawServiceQuery } from "@fitzzero/quickdraw-core/client";
import type { ServiceMethodsMap } from "@project/shared";

interface UseServiceQueryOptions<TResponse> {
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
  skipCache?: boolean;
  onSuccess?: (data: TResponse) => void;
  onError?: (error: string) => void;
}

/**
 * Extract payload type from a service method definition.
 */
type GetPayload<
  TService extends keyof ServiceMethodsMap,
  TMethod extends keyof ServiceMethodsMap[TService]
> = ServiceMethodsMap[TService][TMethod] extends { payload: infer P } ? P : never;

/**
 * Extract response type from a service method definition.
 */
type GetResponse<
  TService extends keyof ServiceMethodsMap,
  TMethod extends keyof ServiceMethodsMap[TService]
> = ServiceMethodsMap[TService][TMethod] extends { response: infer R } ? R : never;

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
  options?: UseServiceQueryOptions<GetResponse<TService, TMethod>>
) {
  return useQuickdrawServiceQuery<
    GetPayload<TService, TMethod>,
    GetResponse<TService, TMethod>
  >(
    serviceName as string,
    methodName,
    payload,
    options
  );
}

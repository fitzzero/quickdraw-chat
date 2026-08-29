"use client";

import { useService as useQuickdrawService } from "@fitzzero/quickdraw-core/client";
import type { ServiceMethodsMap } from "@project/shared";
import type { GetPayload, GetResponse } from "./service-types";

interface UseServiceOptions<TResponse> {
  onSuccess?: (data: TResponse) => void;
  onError?: (error: string) => void;
  timeout?: number;
}

/**
 * Typed wrapper around quickdraw-core's useService hook.
 * Provides project-specific type inference for service methods.
 *
 * @example
 * ```tsx
 * // Full type inference from ServiceMethodsMap
 * const createChat = useService('chatService', 'createChat', {
 *   onSuccess: (data) => {
 *     // data is typed as { id: string }
 *     router.push(`/chat/${data.id}`);
 *   },
 * });
 *
 * // Payload is typed as { title: string; members?: ... }
 * createChat.mutate({ title: 'New Chat' });
 * ```
 */
export function useService<
  TService extends keyof ServiceMethodsMap,
  TMethod extends keyof ServiceMethodsMap[TService] & string,
>(
  serviceName: TService,
  methodName: TMethod,
  options?: UseServiceOptions<GetResponse<TService, TMethod>>,
) {
  // Use the simplified generic signature from quickdraw-core
  return useQuickdrawService<GetPayload<TService, TMethod>, GetResponse<TService, TMethod>>(
    serviceName as string,
    methodName,
    options,
  );
}

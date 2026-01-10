"use client";

import { useService as useQuickdrawService } from "@fitzzero/quickdraw-core/client";
import type { ServiceMethodsMap } from "@project/shared";

interface UseServiceOptions<TResponse> {
  onSuccess?: (data: TResponse) => void;
  onError?: (error: string) => void;
}

type GetResponse<TService extends keyof ServiceMethodsMap, TMethod extends keyof ServiceMethodsMap[TService]> =
  ServiceMethodsMap[TService][TMethod] extends { response: infer R } ? R : never;

/**
 * Typed wrapper around quickdraw-core's useService hook.
 * Provides project-specific type inference for service methods.
 */
export function useService<
  TService extends keyof ServiceMethodsMap,
  TMethod extends keyof ServiceMethodsMap[TService] & string,
>(
  serviceName: TService,
  methodName: TMethod,
  options?: UseServiceOptions<GetResponse<TService, TMethod>>
) {
  // Cast to satisfy quickdraw-core's generic constraint while preserving our strict typing
  return useQuickdrawService<
    Record<string, Record<string, { payload: unknown; response: unknown }>>,
    string,
    string
  >(
    serviceName as string,
    methodName as string,
    options as Parameters<typeof useQuickdrawService>[2]
  );
}

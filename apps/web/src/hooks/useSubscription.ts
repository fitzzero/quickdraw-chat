"use client";

import { useSubscription as useQuickdrawSubscription } from "@fitzzero/quickdraw-core/client";
import type { SubscriptionDataMap, AccessLevel } from "@project/shared";

interface UseSubscriptionOptions<TData> {
  enabled?: boolean;
  onData?: (data: TData) => void;
  onError?: (error: string) => void;
  requiredLevel?: AccessLevel;
}

/**
 * Typed wrapper around quickdraw-core's useSubscription hook.
 * Provides project-specific type inference and includes subscription deduplication.
 * 
 * Multiple components subscribing to the same entity will share a single
 * socket subscription, preventing duplicate network traffic.
 */
export function useSubscription<TService extends keyof SubscriptionDataMap>(
  serviceName: TService,
  entryId: string | null,
  options: UseSubscriptionOptions<SubscriptionDataMap[TService]> = {}
) {
  type TData = SubscriptionDataMap[TService];

  return useQuickdrawSubscription<TData>(
    serviceName as string,
    entryId,
    options
  );
}

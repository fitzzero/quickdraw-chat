"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ServiceResponse, SubscriptionDataMap, AccessLevel } from "@project/shared";
import { useSocket } from "../providers";

interface UseSubscriptionOptions<TData> {
  enabled?: boolean;
  onData?: (data: TData) => void;
  onError?: (error: string) => void;
  requiredLevel?: AccessLevel;
}

export function useSubscription<TService extends keyof SubscriptionDataMap>(
  serviceName: TService,
  entryId: string | null,
  options: UseSubscriptionOptions<SubscriptionDataMap[TService]> = {}
) {
  type TData = SubscriptionDataMap[TService];

  const { socket, isConnected } = useSocket();
  const queryClient = useQueryClient();
  const [isSubscribed, setIsSubscribed] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<TData | null>(null);

  const { enabled = true, onData, onError, requiredLevel = "Read" } = options;

  const queryKey = [serviceName, "subscription", entryId];

  const onDataRef = React.useRef(onData);
  const onErrorRef = React.useRef(onError);
  React.useEffect(() => {
    onDataRef.current = onData;
    onErrorRef.current = onError;
  }, [onData, onError]);

  React.useEffect(() => {
    if (!socket || !isConnected || !enabled || !entryId) {
      return;
    }

    const subscribeEvent = `${serviceName}:subscribe`;
    const updateEvent = `${serviceName}:update:${entryId}`;

    // Handle updates
    const handleUpdate = (updateData: Partial<TData>) => {
      const asAny = updateData as { deleted?: boolean };
      if (asAny.deleted) {
        setData(null);
        return;
      }

      setData((prev) => {
        const merged = prev ? { ...prev, ...updateData } : (updateData as TData);
        onDataRef.current?.(merged);
        return merged;
      });
    };

    socket.on(updateEvent, handleUpdate);

    // Subscribe
    socket.emit(subscribeEvent, { entryId, requiredLevel }, (response: ServiceResponse<TData>) => {
      if (response.success && response.data) {
        setData(response.data);
        setIsSubscribed(true);
        setError(null);
        onDataRef.current?.(response.data);
      } else if (!response.success) {
        setError(response.error);
        setIsSubscribed(false);
        onErrorRef.current?.(response.error);
      }
    });

    return () => {
      socket.off(updateEvent, handleUpdate);
      socket.emit(`${serviceName}:unsubscribe`, { entryId });
      setIsSubscribed(false);
    };
  }, [socket, isConnected, enabled, entryId, serviceName, requiredLevel]);

  return {
    data,
    isLoading: !data && !error && enabled && !!entryId,
    isError: !!error,
    error,
    isSubscribed,
  };
}

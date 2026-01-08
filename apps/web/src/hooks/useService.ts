"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import type { ServiceResponse, ServiceMethodsMap } from "@project/shared";
import { useSocket } from "../providers";

interface UseServiceOptions<TResponse> {
  onSuccess?: (data: TResponse) => void;
  onError?: (error: string) => void;
}

export function useService<
  TService extends keyof ServiceMethodsMap,
  TMethod extends keyof ServiceMethodsMap[TService] & string,
>(
  serviceName: TService,
  methodName: TMethod,
  options?: UseServiceOptions<ServiceMethodsMap[TService][TMethod]["response"]>
) {
  type TPayload = ServiceMethodsMap[TService][TMethod]["payload"];
  type TResponse = ServiceMethodsMap[TService][TMethod]["response"];

  const { socket, isConnected } = useSocket();
  const [error, setError] = React.useState<string | null>(null);

  const optionsRef = React.useRef(options);
  React.useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const mutation = useMutation<TResponse, Error, TPayload>({
    mutationKey: [serviceName, methodName],
    mutationFn: async (payload: TPayload): Promise<TResponse> => {
      if (!socket || !isConnected) {
        throw new Error("Socket not connected");
      }

      return new Promise<TResponse>((resolve, reject) => {
        const eventName = `${serviceName}:${methodName}`;
        const timeout = setTimeout(() => {
          reject(new Error("Request timeout"));
        }, 10000);

        socket.emit(eventName, payload, (response: ServiceResponse<TResponse>) => {
          clearTimeout(timeout);

          if (response.success) {
            resolve(response.data);
          } else {
            reject(new Error(response.error));
          }
        });
      });
    },
    onSuccess: (data) => {
      setError(null);
      optionsRef.current?.onSuccess?.(data);
    },
    onError: (err) => {
      const errorMessage = err.message;
      setError(errorMessage);
      optionsRef.current?.onError?.(errorMessage);
    },
  });

  return {
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error,
    data: mutation.data,
    reset: mutation.reset,
    isReady: !!socket && isConnected,
  };
}

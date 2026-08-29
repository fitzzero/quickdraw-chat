import type { ServiceMethodsMap } from "@project/shared";

/**
 * Extract payload type from a service method definition.
 */
export type GetPayload<
  TService extends keyof ServiceMethodsMap,
  TMethod extends keyof ServiceMethodsMap[TService],
> = ServiceMethodsMap[TService][TMethod] extends { payload: infer P } ? P : never;

/**
 * Extract response type from a service method definition.
 */
export type GetResponse<
  TService extends keyof ServiceMethodsMap,
  TMethod extends keyof ServiceMethodsMap[TService],
> = ServiceMethodsMap[TService][TMethod] extends { response: infer R } ? R : never;

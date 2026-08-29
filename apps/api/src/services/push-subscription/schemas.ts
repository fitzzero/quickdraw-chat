import { z } from "zod";

/** A Web Push endpoint URL. */
export const endpointSchema = z.string().url().max(2048);

/**
 * A browser push subscription: the endpoint plus its encryption keys.
 * Shared by the socket method (`subscribePush`) and the service-worker REST
 * renewal route, which carry the same payload.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
});

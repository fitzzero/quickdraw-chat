// The contract of pushService: a user's Web Push endpoints (the PWA), and
// the admin kit.

import { admin, defineContract, mutation } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import { endpointSchema, isoDateSchema, pushSubscriptionSchema } from "./helpers.js";

const unsubscribePushSchema = z.object({
  endpoint: endpointSchema,
});

const sendTestPushSchema = z.object({});

/**
 * A browser's Web Push registration, one row per endpoint. Browsers mint
 * them; only the admin screen reads the rows.
 */
export const pushSubscriptionRowSchema = z.object({
  id: z.string(),
  userId: z.string(),
  endpoint: z.string(),
  p256dh: z.string(),
  auth: z.string(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

const successSchema = z.object({ success: z.literal(true) });

export const pushContract = defineContract("pushService", {
  entity: pushSubscriptionRowSchema,
  methods: {
    subscribePush: mutation({
      input: pushSubscriptionSchema,
      output: successSchema,
      describe: "Registers this browser's push endpoint for the caller.",
    }),
    unsubscribePush: mutation({
      input: unsubscribePushSchema,
      output: successSchema,
      describe: "Removes one of the caller's push endpoints.",
    }),
    sendTestPush: mutation({
      input: sendTestPushSchema,
      output: z.object({ sent: z.number().int().nonnegative() }),
      describe:
        "Sends a test notification to each of the caller's devices; answers how many took it.",
    }),
    // The admin screens: read and delete only (browsers mint subscriptions)
    ...admin.contract({
      entity: pushSubscriptionRowSchema,
      filter: ["userId"],
      sort: ["createdAt"],
      expose: [
        "adminList",
        "adminGet",
        "adminDelete",
        "adminMeta",
        "adminSubscribers",
        "adminReemit",
      ],
    }),
  },
});

// The contract of pushService, written by @fitzzero/quickdraw-codemod from
// PushServiceMethods and the defineMethod calls of PushService
// (apps/api/src/services/push-subscription/index.ts).
// Every marker below says what to check.

import { defineContract, mutation, todoSchema } from "@fitzzero/quickdraw-core";
import { z } from "zod";
import { endpointSchema, pushSubscriptionSchema } from "./helpers.js";

const unsubscribePushSchema = z.object({
  endpoint: endpointSchema,
});

const sendTestPushSchema = z.object({});

export const pushContract = defineContract("pushService", {
  // quickdraw-migrate: review [contract] the 4.x DTO (PushSubscription) is not a type of the shared package: describe the entity, whose keys are the fields subscribers receive
  entity: todoSchema<{ id: string }>({ keys: ["id"] }),
  methods: {
    // quickdraw-migrate: review [contract] mutation, chosen from its name; output: todoSchema of the 4.x response type
    subscribePush: mutation({
      input: pushSubscriptionSchema,
      output: todoSchema<{ success: true }>(),
    }),
    // quickdraw-migrate: review [contract] mutation, chosen from its name; output: todoSchema of the 4.x response type
    unsubscribePush: mutation({
      input: unsubscribePushSchema,
      output: todoSchema<{ success: true }>(),
    }),
    // quickdraw-migrate: review [contract] mutation, chosen from its name; output: todoSchema of the 4.x response type
    sendTestPush: mutation({ input: sendTestPushSchema, output: todoSchema<{ sent: number }>() }),
  },
});

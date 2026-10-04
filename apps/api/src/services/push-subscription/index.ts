import type { PushNotificationPayload } from "@project/shared";
import webpush from "web-push";
import { z } from "zod";
import { createServiceLogger, errorMeta } from "../../utils/logger.js";
import { qd } from "../../quickdraw.js";
import { pushContract } from "@project/shared";
import { db } from "../../db.js";

const logger = createServiceLogger("pushService");

// Zod schemas for validation
// Admin schema - defines fields available for admin CRUD
const adminPushSubscriptionSchema = z.object({
  userId: z.string(),
  endpoint: z.string(),
  p256dh: z.string(),
  auth: z.string(),
});

/** How long push services may queue an undelivered notification. */
const PUSH_TTL_SECONDS = 86400;

/** Body text cap — push payloads are size-limited (~4kb) and previews short. */
const PUSH_BODY_MAX_CHARS = 140;

/**
 * Delivers one payload to one endpoint. Injectable so tests capture sends
 * without touching real push services; production defaults to web-push.
 * Throw errors with `statusCode` 410/404 to signal an expired endpoint.
 */
export type PushTransport = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
) => Promise<void>;

export interface PushServiceOptions {
  /** Delivery override for tests; omit to use web-push (VAPID env keys). */
  transport?: PushTransport;
  /** When set, chat pushes skip users with a live socket. */
  isUserOnline?: (userId: string) => Promise<boolean>;
}

/**
 * Build the default web-push transport. Web push is a soft feature: without
 * VAPID keys the API boots normally and every send is a no-op, so forks that
 * don't want push never have to think about it.
 */
function createWebPushTransport(): PushTransport | undefined {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey) {
    logger.info("VAPID keys not set — web push disabled (see env.example)");
    return undefined;
  }
  if (!subject) {
    // The subject is sent to push services as an operator contact — require
    // an explicit value rather than shipping a default nobody owns.
    logger.warn("VAPID_SUBJECT not set — web push disabled (set e.g. mailto:you@example.com)");
    return undefined;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return async (subscription, payload) => {
    await webpush.sendNotification(subscription, payload, { TTL: PUSH_TTL_SECONDS });
  };
}

// quickdraw-migrate: review [this] 4.x constructor code of PushService: a service object has no constructor; move what still matters to module scope, a job or the server's start-up, then delete this function
function setUpPushService(): void {
  installAdmin();
}

/** Upsert a subscription; endpoint is the identity (browser re-subscribes reuse rows). */
export async function resubscribe(
  userId: string,
  endpoint: string,
  keys: { p256dh: string; auth: string },
): Promise<void> {
  await db.pushSubscription.upsert({
    where: { endpoint },
    create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
    update: { userId, p256dh: keys.p256dh, auth: keys.auth },
  });
}

/**
 * Send a payload to every subscription of one user. Endpoints the push
 * service reports gone (410/404) are deleted. Returns delivered count.
 */
export async function sendToUser(
  userId: string,
  payload: PushNotificationPayload,
): Promise<number> {
  // quickdraw-migrate: review [this] this.transport was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
  const transport = this.transport;
  if (!transport) return 0;

  const subscriptions = await db.pushSubscription.findMany({ where: { userId } });
  if (subscriptions.length === 0) return 0;

  const body = JSON.stringify(payload);
  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await transport(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          // Expired/revoked endpoint — prune so we stop paying for it
          await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          logger.info("Removed stale push subscription", { userId, statusCode });
        } else {
          logger.debug("Push send failed", { userId, statusCode, ...errorMeta(error) });
        }
        throw error;
      }
    }),
  );
  return results.filter((r) => r.status === "fulfilled").length;
}

/**
 * Push a new chat message to members who are not the sender and have no
 * live socket. Fire-and-forget: called from MessageService.afterCreate,
 * so it must never throw into (or slow down) the message write path.
 */
export function notifyNewMessage(message: {
  chatId: string;
  userId: string;
  content: string;
}): void {
  // quickdraw-migrate: review [this] this.transport was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
  if (!this.transport) return;
  void deliverMessagePush(message).catch((error: unknown) => {
    logger.error("Chat message push failed", { chatId: message.chatId, ...errorMeta(error) });
  });
}

async function deliverMessagePush(message: {
  chatId: string;
  userId: string;
  content: string;
}): Promise<void> {
  // Read-only lookups on other services' models (mutations stay with them)
  const [chat, sender, members] = await Promise.all([
    db.chat.findUnique({ where: { id: message.chatId }, select: { title: true } }),
    db.user.findUnique({ where: { id: message.userId }, select: { name: true } }),
    db.chatMember.findMany({
      where: { chatId: message.chatId },
      select: { userId: true },
    }),
  ]);
  if (!chat) return;

  const preview = `${sender?.name ?? "Someone"}: ${message.content}`;
  const payload: PushNotificationPayload = {
    title: chat.title,
    body:
      preview.length > PUSH_BODY_MAX_CHARS
        ? `${preview.slice(0, PUSH_BODY_MAX_CHARS - 1)}…`
        : preview,
    url: `/chats/${message.chatId}`,
    // One notification per chat: a newer message replaces the last one
    tag: `chat-${message.chatId}`,
  };

  for (const member of members) {
    if (member.userId === message.userId) continue;
    // quickdraw-migrate: review [this] this.isUserOnline was 4.x service-instance state: a service object has none. Import what it held, pass it in, or call another service with ctx.services
    if (this.isUserOnline && (await this.isUserOnline(member.userId))) continue;
    await sendToUser(member.userId, payload);
  }
}

function installAdmin(): void {
  // Read/delete only: subscriptions are browser-minted, never hand-created
  // quickdraw-migrate: review [admin] installAdminMethods: use the admin kit (...admin.contract({ entity }) in the contract, ...admin.handlers(contract, options) in methods)
  this.installAdminMethods({
    expose: { list: true, get: true, create: false, update: false, delete: true },
    access: {
      list: "Admin",
      get: "Admin",
      create: "Admin",
      update: "Admin",
      delete: "Admin",
      setEntryACL: "Admin",
      getSubscribers: "Admin",
      reemit: "Admin",
      unsubscribeAll: "Admin",
    },
    schema: adminPushSubscriptionSchema,
    displayName: "Push Subscriptions",
    tableColumns: ["id", "userId", "endpoint", "createdAt"],
  });
}

/**
 * PushService — Web Push subscriptions for the PWA.
 *
 * Browsers register their push endpoint here (subscribePush) after the user
 * grants notification permission; `sendToUser` fans a payload out to every
 * endpoint of a user and prunes the ones the push service reports dead
 * (410/404). New chat messages notify offline members via notifyNewMessage
 * (fire-and-forget from MessageService.afterCreate — never in a write path).
 */
export const pushService = qd.defineService(pushContract, {
  model: "pushSubscription",
  methods: {
    subscribePush: {
      // quickdraw-migrate: review [access] "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
      access: "authenticated",
      handler: async ({ input, ctx }) => {
        await resubscribe(ctx.principal.userId, input.endpoint, input.keys);
        logger.info("Push subscription registered", { userId: ctx.principal.userId });
        return { success: true as const };
      },
    },
    unsubscribePush: {
      // quickdraw-migrate: review [access] "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
      access: "authenticated",
      handler: async ({ input, ctx, db }) => {
        await db.pushSubscription.deleteMany({
          where: { endpoint: input.endpoint, userId: ctx.principal.userId },
        });
        return { success: true as const };
      },
    },
    sendTestPush: {
      // quickdraw-migrate: review [access] "Read" with no row id let every signed-in user call this in 4.x, and "authenticated" keeps that; narrow it ({ service: "Read" }, { entry: "Read", id } or a scope form) if that was not meant
      access: "authenticated",
      handler: async ({ ctx }) => {
        const sent = await sendToUser(ctx.principal.userId, {
          title: "Test notification",
          body: "Push notifications are working on this device.",
          url: "/account",
          tag: "test-push",
        });
        return { sent };
      },
    },
  },
});

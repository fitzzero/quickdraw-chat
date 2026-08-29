import type { Prisma, PrismaClient, PushSubscription } from "@project/db";
import type { PushNotificationPayload, PushServiceMethods } from "@project/shared";
import { BaseService } from "@fitzzero/quickdraw-core/server";
import webpush from "web-push";
import { z } from "zod";
import { createServiceLogger, errorMeta } from "../../utils/logger.js";
import { requireAuth } from "../shared/index.js";
import { endpointSchema, pushSubscriptionSchema } from "./schemas.js";

const logger = createServiceLogger("pushService");

// Zod schemas for validation
const unsubscribePushSchema = z.object({
  endpoint: endpointSchema,
});

const sendTestPushSchema = z.object({});

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

/**
 * PushService — Web Push subscriptions for the PWA.
 *
 * Browsers register their push endpoint here (subscribePush) after the user
 * grants notification permission; `sendToUser` fans a payload out to every
 * endpoint of a user and prunes the ones the push service reports dead
 * (410/404). New chat messages notify offline members via notifyNewMessage
 * (fire-and-forget from MessageService.afterCreate — never in a write path).
 */
export class PushService extends BaseService<
  PushSubscription,
  Prisma.PushSubscriptionUncheckedCreateInput,
  Prisma.PushSubscriptionUpdateInput,
  PushServiceMethods
> {
  private readonly prisma: PrismaClient;
  private readonly transport: PushTransport | undefined;
  private readonly isUserOnline: ((userId: string) => Promise<boolean>) | undefined;

  constructor(prisma: PrismaClient, options: PushServiceOptions = {}) {
    super({ serviceName: "pushService", hasEntryACL: false });
    this.prisma = prisma;
    this.transport = options.transport ?? createWebPushTransport();
    this.isUserOnline = options.isUserOnline;
    this.setDelegate(prisma.pushSubscription);
    this.initMethods();
    this.installAdmin();
  }

  /** Whether sends can go anywhere (VAPID configured or transport injected). */
  public get enabled(): boolean {
    return this.transport !== undefined;
  }

  /** Upsert a subscription; endpoint is the identity (browser re-subscribes reuse rows). */
  public async resubscribe(
    userId: string,
    endpoint: string,
    keys: { p256dh: string; auth: string },
  ): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      update: { userId, p256dh: keys.p256dh, auth: keys.auth },
    });
  }

  /**
   * Send a payload to every subscription of one user. Endpoints the push
   * service reports gone (410/404) are deleted. Returns delivered count.
   */
  public async sendToUser(userId: string, payload: PushNotificationPayload): Promise<number> {
    const transport = this.transport;
    if (!transport) return 0;

    const subscriptions = await this.prisma.pushSubscription.findMany({ where: { userId } });
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
            await this.prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
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
  public notifyNewMessage(message: { chatId: string; userId: string; content: string }): void {
    if (!this.transport) return;
    void this.deliverMessagePush(message).catch((error: unknown) => {
      logger.error("Chat message push failed", { chatId: message.chatId, ...errorMeta(error) });
    });
  }

  private async deliverMessagePush(message: {
    chatId: string;
    userId: string;
    content: string;
  }): Promise<void> {
    // Read-only lookups on other services' models (mutations stay with them)
    const [chat, sender, members] = await Promise.all([
      this.prisma.chat.findUnique({ where: { id: message.chatId }, select: { title: true } }),
      this.prisma.user.findUnique({ where: { id: message.userId }, select: { name: true } }),
      this.prisma.chatMember.findMany({
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
      if (this.isUserOnline && (await this.isUserOnline(member.userId))) continue;
      await this.sendToUser(member.userId, payload);
    }
  }

  private initMethods(): void {
    // Register this browser's push endpoint for the calling user
    this.defineMethod(
      "subscribePush",
      "Read",
      async (payload, ctx) => {
        requireAuth(ctx);
        await this.resubscribe(ctx.userId, payload.endpoint, payload.keys);
        logger.info("Push subscription registered", { userId: ctx.userId });
        return { success: true as const };
      },
      { schema: pushSubscriptionSchema },
    );

    // Remove this browser's push endpoint (only the owner may remove it)
    this.defineMethod(
      "unsubscribePush",
      "Read",
      async (payload, ctx) => {
        requireAuth(ctx);
        await this.prisma.pushSubscription.deleteMany({
          where: { endpoint: payload.endpoint, userId: ctx.userId },
        });
        return { success: true as const };
      },
      { schema: unsubscribePushSchema },
    );

    // Let users verify their setup end-to-end from the account page
    this.defineMethod(
      "sendTestPush",
      "Read",
      async (_payload, ctx) => {
        requireAuth(ctx);
        const sent = await this.sendToUser(ctx.userId, {
          title: "Test notification",
          body: "Push notifications are working on this device.",
          url: "/account",
          tag: "test-push",
        });
        return { sent };
      },
      { schema: sendTestPushSchema },
    );

    // Fail fast at construction if the method map and definitions drift
    this.verifyAllMethods(["subscribePush", "unsubscribePush", "sendTestPush"]);
  }

  private installAdmin(): void {
    // Read/delete only: subscriptions are browser-minted, never hand-created
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
}

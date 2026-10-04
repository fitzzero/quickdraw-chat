import type { PushNotificationPayload } from "@project/shared";
import { admin, owner } from "@fitzzero/quickdraw-core/server";
import { pushContract } from "@project/shared";
import webpush from "web-push";
import type { db as appDb } from "../../db.js";
import { createServiceLogger, errorMeta } from "../../utils/logger.js";
import { qd } from "../../quickdraw.js";

type Db = typeof appDb;

const logger = createServiceLogger("pushService");

/** How long push services may queue an undelivered notification. */
const PUSH_TTL_SECONDS = 86400;

/** Body text cap — push payloads are size-limited (~4kb) and previews short. */
const PUSH_BODY_MAX_CHARS = 140;

/** The most devices of one user a push goes to. */
const MAX_SUBSCRIPTIONS_PER_USER = 50;

/** The most members of a chat a new-message push considers. */
const MAX_PUSHED_MEMBERS = 500;

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
  /** When set, chat pushes skip users with a live socket. Default: quickdraw's presence. */
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
 * How pushes go out: 4.x's PushService constructor options, as module state,
 * set once by the server's start-up (`configurePush`). A service object has
 * no constructor, so the transport lives here.
 */
const delivery: {
  transport: PushTransport | undefined;
  isUserOnline: (userId: string) => Promise<boolean>;
} = {
  transport: undefined,
  isUserOnline: (userId) => qd.presence.isOnline(userId),
};

/**
 * Sets the push transport (default: web-push from the VAPID env keys, or no
 * sends without them) and the online check (default: quickdraw's presence).
 * The server calls it at start-up; tests pass a capturing transport.
 */
export function configurePush(options: PushServiceOptions = {}): void {
  delivery.transport = options.transport ?? createWebPushTransport();
  delivery.isUserOnline = options.isUserOnline ?? ((userId) => qd.presence.isOnline(userId));
}

/**
 * Send a payload to every subscription of one user. Endpoints the push
 * service reports gone (410/404) are deleted. Returns delivered count.
 */
async function sendToUser(
  db: Db,
  userId: string,
  payload: PushNotificationPayload,
): Promise<number> {
  const { transport } = delivery;
  if (!transport) return 0;

  const subscriptions = await db.pushSubscription.findMany({
    where: { userId },
    take: MAX_SUBSCRIPTIONS_PER_USER,
  });
  if (subscriptions.length === 0) return 0;

  const body = JSON.stringify(payload);
  const gone: string[] = [];
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
          gone.push(sub.id);
          logger.info("Removing stale push subscription", { userId, statusCode });
        } else {
          logger.debug("Push send failed", { userId, statusCode, ...errorMeta(error) });
        }
        throw error;
      }
    }),
  );
  if (gone.length > 0) {
    await db.pushSubscription.deleteMany({ where: { id: { in: gone } } });
  }
  return results.filter((r) => r.status === "fulfilled").length;
}

async function deliverMessagePush(
  db: Db,
  message: { chatId: string; userId: string; content: string },
): Promise<void> {
  // Read-only lookups on other services' models (mutations stay with them)
  const [chat, sender, members] = await Promise.all([
    db.chat.findUnique({ where: { id: message.chatId }, select: { title: true } }),
    db.user.findUnique({ where: { id: message.userId }, select: { name: true } }),
    db.chatMember.findMany({
      where: { chatId: message.chatId, userId: { not: message.userId } },
      select: { userId: true },
      take: MAX_PUSHED_MEMBERS,
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

  const online = await Promise.all(members.map((member) => delivery.isUserOnline(member.userId)));
  const offline = members.filter((_member, index) => online[index] !== true);
  await Promise.all(offline.map((member) => sendToUser(db, member.userId, payload)));
}

/**
 * Push a new chat message to members who are not the sender and have no
 * live socket. Fire-and-forget from messageService.postMessage, after its
 * write: it never throws into (or slows down) the post.
 */
export function notifyNewMessage(
  db: Db,
  message: { chatId: string; userId: string; content: string },
): void {
  if (!delivery.transport) return;
  // quickdraw-5.0 finding: a handler cannot start background work in a unit of work of its own: qd.run called here joins postMessage's unit, whose frame has closed by the time a slow push service answers 410, so pruning that endpoint flushes as an ambient write (with its development warning) instead of in a unit
  void deliverMessagePush(db, message).catch((error: unknown) => {
    logger.error("Chat message push failed", { chatId: message.chatId, ...errorMeta(error) });
  });
}

/**
 * PushService — Web Push subscriptions for the PWA.
 *
 * Browsers register their push endpoint here (subscribePush) after the user
 * grants notification permission; a send fans a payload out to every
 * endpoint of a user and prunes the ones the push service reports dead
 * (410/404). New chat messages notify offline members via notifyNewMessage.
 * Each subscription belongs to its user (`owner`); only the admin screens
 * read other users' rows.
 */
export const pushService = qd.defineService(pushContract, {
  model: "pushSubscription",
  access: owner("userId"),
  methods: {
    subscribePush: {
      // the caller's own endpoint (4.x: "Read" without a row id)
      access: "authenticated",
      handler: async ({ input, ctx, db }) => {
        const { userId } = ctx.principal;
        // The endpoint is the identity: a browser re-subscribing reuses its row,
        // and one that switched accounts moves it to the caller
        await db.pushSubscription.upsert({
          where: { endpoint: input.endpoint },
          create: {
            userId,
            endpoint: input.endpoint,
            p256dh: input.keys.p256dh,
            auth: input.keys.auth,
          },
          update: { userId, p256dh: input.keys.p256dh, auth: input.keys.auth },
          select: { id: true },
        });
        logger.info("Push subscription registered", { userId });
        return { success: true as const };
      },
    },
    unsubscribePush: {
      // removes only the caller's own endpoint (4.x: "Read" without a row id)
      access: "authenticated",
      handler: async ({ input, ctx, db }) => {
        await db.pushSubscription.deleteMany({
          where: { endpoint: input.endpoint, userId: ctx.principal.userId },
        });
        return { success: true as const };
      },
    },
    sendTestPush: {
      // sends to the caller's own devices (4.x: "Read" without a row id)
      access: "authenticated",
      handler: async ({ ctx, db }) => {
        const sent = await sendToUser(db, ctx.principal.userId, {
          title: "Test notification",
          body: "Push notifications are working on this device.",
          url: "/account",
          tag: "test-push",
        });
        return { sent };
      },
    },
    ...admin.handlers(pushContract, { displayName: "Push Subscriptions" }),
  },
});

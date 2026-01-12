import type { Message, Prisma, PrismaClient } from "@project/db";
import type { MessageServiceMethods, AccessLevel } from "@project/shared";
import { BaseService } from "@fitzzero/quickdraw-core/server";
import { z } from "zod";

// Zod schemas for validation
const postMessageSchema = z.object({
  chatId: z.string().cuid("Invalid chat ID"),
  content: z.string().min(1, "Content is required").max(10000, "Content must be 10000 characters or less"),
  role: z.enum(["user", "assistant", "system"]).optional(),
});

const listMessagesSchema = z.object({
  chatId: z.string().cuid("Invalid chat ID"),
  limit: z.number().int().min(1).max(100).optional(),
  before: z.string().cuid().optional(),
});

const deleteMessageSchema = z.object({
  id: z.string().cuid("Invalid message ID"),
});

type ServiceMethodsRecord = Record<
  string,
  { payload: unknown; response: unknown }
>;

export class MessageService extends BaseService<
  Message,
  Prisma.MessageCreateInput,
  Prisma.MessageUpdateInput,
  MessageServiceMethods & ServiceMethodsRecord
> {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    // Enable entry ACL - message creator gets Admin in their message's ACL
    super({ serviceName: "messageService", hasEntryACL: true });
    this.prisma = prisma;
    this.setDelegate(prisma.message);
    this.initMethods();
  }

  // Check chat membership for posting/listing messages
  private async checkChatAccess(
    userId: string,
    chatId: string,
    requiredLevel: AccessLevel
  ): Promise<boolean> {
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { level: true },
    });

    if (!member) return false;
    return this.isLevelSufficient(member.level as AccessLevel, requiredLevel);
  }

  private initMethods(): void {
    // Post a new message
    this.defineMethod("postMessage", "Read", async (payload, ctx) => {
      if (!ctx.userId) throw new Error("Authentication required");

      // Check chat access
      const hasAccess = await this.checkChatAccess(
        ctx.userId,
        payload.chatId,
        "Read"
      );
      if (!hasAccess) throw new Error("Access denied to chat");

      const message = await this.prisma.message.create({
        data: {
          chatId: payload.chatId,
          userId: ctx.userId,
          content: payload.content,
          role: payload.role ?? "user",
          // Creator gets Admin access in ACL for delete permissions
          acl: [{ userId: ctx.userId, level: "Admin" }],
        },
        include: {
          user: {
            select: { id: true, name: true, image: true },
          },
        },
      });

      // Create DTO for the message
      const messageDTO = {
        id: message.id,
        chatId: message.chatId,
        userId: message.userId,
        content: message.content,
        role: message.role,
        createdAt: message.createdAt.toISOString(),
        user: message.user,
      };

      // Emit to message subscribers (for individual message updates)
      this.emitUpdate(message.id, message);

      // Broadcast to all chat subscribers via Socket.io room
      // This uses the room that chatService subscribers automatically join
      this.emitToRoom(
        `chatService:${payload.chatId}`,
        "chat:message",
        messageDTO
      );

      return { id: message.id };
    }, { schema: postMessageSchema });

    // List messages for a chat
    this.defineMethod("listMessages", "Read", async (payload, ctx) => {
      if (!ctx.userId) throw new Error("Authentication required");

      // Check chat access
      const hasAccess = await this.checkChatAccess(
        ctx.userId,
        payload.chatId,
        "Read"
      );
      if (!hasAccess) throw new Error("Access denied to chat");

      const limit = Math.min(payload.limit ?? 50, 100);

      const whereClause: Prisma.MessageWhereInput = { chatId: payload.chatId };
      if (payload.before) {
        const beforeMessage = await this.prisma.message.findUnique({
          where: { id: payload.before },
          select: { createdAt: true },
        });
        if (beforeMessage) {
          whereClause.createdAt = { lt: beforeMessage.createdAt };
        }
      }

      const messages = await this.prisma.message.findMany({
        where: whereClause,
        include: {
          user: {
            select: { id: true, name: true, image: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      return messages.reverse().map((m) => ({
        id: m.id,
        chatId: m.chatId,
        userId: m.userId,
        content: m.content,
        role: m.role,
        createdAt: m.createdAt.toISOString(),
        user: m.user,
      }));
    }, { schema: listMessagesSchema });

    // Delete a message - requires Admin in message ACL (owner) or service-level access
    // Framework handles ACL check automatically via hasEntryACL: true
    this.defineMethod(
      "deleteMessage",
      "Admin",
      async (payload, _ctx) => {
        await this.prisma.message.delete({ where: { id: payload.id } });
        this.emitUpdate(payload.id, {
          id: payload.id,
          deleted: true,
        } as unknown as Partial<Message>);
        return { id: payload.id, deleted: true as const };
      },
      { 
        schema: deleteMessageSchema,
        resolveEntryId: (p) => p.id 
      }
    );
  }
}

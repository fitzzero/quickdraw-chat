import type { Message, Prisma, PrismaClient } from "@project/db";
import type { MessageServiceMethods, MessageDTO, AccessLevel } from "@project/shared";
import { BaseService } from "@fitzzero/quickdraw-core/server";

export class MessageService extends BaseService<
  Message,
  Prisma.MessageCreateInput,
  Prisma.MessageUpdateInput,
  MessageServiceMethods
> {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({ serviceName: "messageService", hasEntryACL: false });
    this.prisma = prisma;
    this.setDelegate(prisma.message);
    this.initMethods();
  }

  // Messages inherit access from their parent chat
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
      const hasAccess = await this.checkChatAccess(ctx.userId, payload.chatId, "Read");
      if (!hasAccess) throw new Error("Access denied to chat");

      const message = await this.prisma.message.create({
        data: {
          chatId: payload.chatId,
          userId: ctx.userId,
          content: payload.content,
          role: payload.role ?? "user",
        },
        include: {
          user: {
            select: { id: true, name: true, image: true },
          },
        },
      });

      const messageDTO: MessageDTO = {
        id: message.id,
        chatId: message.chatId,
        userId: message.userId,
        content: message.content,
        role: message.role,
        createdAt: message.createdAt.toISOString(),
        user: message.user,
      };

      // Emit to message subscribers and chat subscribers
      this.emitUpdate(message.id, message);

      return { id: message.id };
    });

    // List messages for a chat
    this.defineMethod("listMessages", "Read", async (payload, ctx) => {
      if (!ctx.userId) throw new Error("Authentication required");

      // Check chat access
      const hasAccess = await this.checkChatAccess(ctx.userId, payload.chatId, "Read");
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
    });

    // Delete a message
    this.defineMethod(
      "deleteMessage",
      "Moderate",
      async (payload, ctx) => {
        // Get the message to check chat access
        const message = await this.prisma.message.findUnique({
          where: { id: payload.id },
          select: { chatId: true, userId: true },
        });

        if (!message) throw new Error("Message not found");

        // Check if user owns the message or has chat moderation access
        const isOwner = message.userId === ctx.userId;
        const hasModAccess = ctx.userId
          ? await this.checkChatAccess(ctx.userId, message.chatId, "Moderate")
          : false;

        if (!isOwner && !hasModAccess) {
          throw new Error("Cannot delete this message");
        }

        await this.prisma.message.delete({ where: { id: payload.id } });
        this.emitUpdate(payload.id, { id: payload.id, deleted: true } as unknown as Partial<Message>);

        return { id: payload.id, deleted: true as const };
      },
      { resolveEntryId: (p) => p.id }
    );
  }
}

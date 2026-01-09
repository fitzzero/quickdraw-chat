import type { Chat, Prisma, PrismaClient } from "@project/db";
import type { ChatServiceMethods, ACL, AccessLevel } from "@project/shared";
import { BaseService } from "@fitzzero/quickdraw-core/server";

export class ChatService extends BaseService<
  Chat,
  Prisma.ChatCreateInput,
  Prisma.ChatUpdateInput,
  ChatServiceMethods
> {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({ serviceName: "chatService", hasEntryACL: true });
    this.prisma = prisma;
    this.setDelegate(prisma.chat);
    this.initMethods();
  }

  // Check if user is a member of the chat with sufficient access
  protected override async checkEntryACL(
    userId: string,
    chatId: string,
    requiredLevel: AccessLevel
  ): Promise<boolean> {
    // Check chat membership
    const member = await this.prisma.chatMember.findUnique({
      where: { chatId_userId: { chatId, userId } },
      select: { level: true },
    });

    if (!member) return false;
    return this.isLevelSufficient(member.level as AccessLevel, requiredLevel);
  }

  private initMethods(): void {
    // Create a new chat
    this.defineMethod("createChat", "Read", async (payload, ctx) => {
      if (!ctx.userId) throw new Error("Authentication required");

      // Create chat and add creator as Admin
      const chat = await this.prisma.chat.create({
        data: {
          title: payload.title,
          acl: [{ userId: ctx.userId, level: "Admin" }],
          members: {
            create: [
              { userId: ctx.userId, level: "Admin" },
              ...(payload.members?.map((m) => ({
                userId: m.userId,
                level: m.level,
              })) ?? []),
            ],
          },
        },
        select: { id: true },
      });

      return { id: chat.id };
    });

    // Update chat title
    this.defineMethod(
      "updateTitle",
      "Moderate",
      async (payload, _ctx) => {
        const updated = await this.prisma.chat.update({
          where: { id: payload.id },
          data: { title: payload.title },
          select: { id: true, title: true },
        });

        this.emitUpdate(payload.id, updated);
        return updated;
      },
      { resolveEntryId: (p) => p.id }
    );

    // Invite user to chat
    this.defineMethod(
      "inviteUser",
      "Moderate",
      async (payload, _ctx) => {
        // Add or update membership
        await this.prisma.chatMember.upsert({
          where: { chatId_userId: { chatId: payload.id, userId: payload.userId } },
          update: { level: payload.level },
          create: { chatId: payload.id, userId: payload.userId, level: payload.level },
        });

        // Update ACL on chat
        const chat = await this.prisma.chat.findUnique({
          where: { id: payload.id },
          select: { acl: true },
        });
        
        const currentAcl = (chat?.acl as ACL) ?? [];
        const newAcl = currentAcl.filter((a) => a.userId !== payload.userId);
        newAcl.push({ userId: payload.userId, level: payload.level });
        
        await this.prisma.chat.update({
          where: { id: payload.id },
          data: { acl: newAcl },
        });

        return { id: payload.id };
      },
      { resolveEntryId: (p) => p.id }
    );

    // Remove user from chat
    this.defineMethod(
      "removeUser",
      "Moderate",
      async (payload, _ctx) => {
        await this.prisma.chatMember.delete({
          where: { chatId_userId: { chatId: payload.id, userId: payload.userId } },
        });

        // Update ACL
        const chat = await this.prisma.chat.findUnique({
          where: { id: payload.id },
          select: { acl: true },
        });
        
        const currentAcl = (chat?.acl as ACL) ?? [];
        const newAcl = currentAcl.filter((a) => a.userId !== payload.userId);
        
        await this.prisma.chat.update({
          where: { id: payload.id },
          data: { acl: newAcl },
        });

        return { id: payload.id };
      },
      { resolveEntryId: (p) => p.id }
    );

    // Leave chat
    this.defineMethod(
      "leaveChat",
      "Read",
      async (payload, ctx) => {
        if (!ctx.userId) throw new Error("Authentication required");

        await this.prisma.chatMember.delete({
          where: { chatId_userId: { chatId: payload.id, userId: ctx.userId } },
        });

        // Update ACL
        const chat = await this.prisma.chat.findUnique({
          where: { id: payload.id },
          select: { acl: true },
        });
        
        const currentAcl = (chat?.acl as ACL) ?? [];
        const newAcl = currentAcl.filter((a) => a.userId !== ctx.userId);
        
        await this.prisma.chat.update({
          where: { id: payload.id },
          data: { acl: newAcl },
        });

        return { id: payload.id };
      },
      { resolveEntryId: (p) => p.id }
    );

    // List user's chats
    this.defineMethod("listMyChats", "Read", async (payload, ctx) => {
      if (!ctx.userId) throw new Error("Authentication required");

      const page = payload.page ?? 1;
      const pageSize = Math.min(payload.pageSize ?? 20, 100);

      const memberships = await this.prisma.chatMember.findMany({
        where: { userId: ctx.userId },
        include: {
          chat: {
            include: {
              _count: { select: { members: true } },
              messages: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { createdAt: true },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      });

      return memberships.map((m) => ({
        id: m.chat.id,
        title: m.chat.title,
        memberCount: m.chat._count.members,
        lastMessageAt: m.chat.messages[0]?.createdAt.toISOString() ?? null,
      }));
    });

    // Delete chat
    this.defineMethod(
      "deleteChat",
      "Admin",
      async (payload, _ctx) => {
        await this.prisma.chat.delete({ where: { id: payload.id } });
        this.emitUpdate(payload.id, { id: payload.id, deleted: true } as Partial<Chat>);
        return { id: payload.id, deleted: true as const };
      },
      { resolveEntryId: (p) => p.id }
    );
  }
}

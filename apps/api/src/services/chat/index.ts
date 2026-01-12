import type { Chat, Prisma, PrismaClient } from "@project/db";
import type { ChatServiceMethods, AccessLevel } from "@project/shared";
import { BaseService } from "@fitzzero/quickdraw-core/server";
import { z } from "zod";

// Zod schemas for validation
const createChatSchema = z.object({
  title: z.string().min(1, "Title is required").max(100, "Title must be 100 characters or less"),
  members: z.array(z.object({
    userId: z.string().cuid("Invalid user ID"),
    level: z.enum(["Read", "Moderate", "Admin"]),
  })).optional(),
});

const updateTitleSchema = z.object({
  id: z.string().cuid("Invalid chat ID"),
  title: z.string().min(1, "Title is required").max(100, "Title must be 100 characters or less"),
});

const getChatMembersSchema = z.object({
  chatId: z.string().cuid("Invalid chat ID"),
});

const inviteUserSchema = z.object({
  id: z.string().cuid("Invalid chat ID"),
  userId: z.string().cuid("Invalid user ID"),
  level: z.enum(["Read", "Moderate", "Admin"]),
});

const leaveSchema = z.object({
  id: z.string().cuid("Invalid chat ID"),
});

const deleteChatSchema = z.object({
  id: z.string().cuid("Invalid chat ID"),
});

const removeUserSchema = z.object({
  id: z.string().cuid("Invalid chat ID"),
  userId: z.string().cuid("Invalid user ID"),
});

const inviteByNameSchema = z.object({
  chatId: z.string().cuid("Invalid chat ID"),
  userName: z.string().min(1, "Username is required"),
  level: z.enum(["Read", "Moderate", "Admin"]),
});

const listMyChatsSchema = z.object({
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

// Admin schema - defines fields available for admin CRUD
const adminChatSchema = z.object({
  title: z.string(),
});

type ServiceMethodsRecord = Record<
  string,
  { payload: unknown; response: unknown }
>;

export class ChatService extends BaseService<
  Chat,
  Prisma.ChatCreateInput,
  Prisma.ChatUpdateInput,
  ChatServiceMethods & ServiceMethodsRecord
> {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    // hasEntryACL is true - we override checkEntryACL to use ChatMember table
    // instead of the default JSON acl field pattern (which Document uses)
    super({ serviceName: "chatService", hasEntryACL: true });
    this.prisma = prisma;
    this.setDelegate(prisma.chat);
    this.initMethods();

    // Install admin CRUD methods
    this.installAdminMethods({
      expose: {
        list: true,
        get: true,
        create: true,
        update: true,
        delete: true,
      },
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
      schema: adminChatSchema,
      displayName: "Chats",
      tableColumns: ["id", "title", "createdAt", "updatedAt"],
    });
  }

  // Check if user is a member of the chat with sufficient access
  // This overrides the base checkAccess since we use membership table
  protected override checkAccess(
    _userId: string,
    _chatId: string,
    _requiredLevel: AccessLevel,
    _socket: unknown
  ): boolean {
    // We need async check, so return false here and do it in checkEntryACL
    return false;
  }

  // Check access via ChatMember table (called after checkAccess returns false)
  protected override async checkEntryACL(
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

  // Helper to fetch members with user details
  private async fetchChatMembers(chatId: string): Promise<{
    id: string;
    userId: string;
    level: AccessLevel;
    user: { id: string; name: string | null; image: string | null };
  }[]> {
    const members = await this.prisma.chatMember.findMany({
      where: { chatId },
      include: {
        user: {
          select: { id: true, name: true, image: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      level: m.level as AccessLevel,
      user: {
        id: m.user.id,
        name: m.user.name,
        image: m.user.image,
      },
    }));
  }

  // Helper to emit member updates to all chat subscribers
  private async emitMemberUpdate(chatId: string): Promise<void> {
    const members = await this.fetchChatMembers(chatId);
    this.emitToRoom(`chatService:${chatId}`, "chat:memberUpdate", { members });
  }

  private initMethods(): void {
    // Create a new chat - demonstrates Zod validation
    this.defineMethod(
      "createChat",
      "Read",
      async (payload, ctx) => {
        if (!ctx.userId) throw new Error("Authentication required");

        // Create chat and add creator as Admin (nested write is atomic)
        const chat = await this.prisma.chat.create({
          data: {
            title: payload.title,
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
      },
      { schema: createChatSchema }
    );

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
      { 
        schema: updateTitleSchema,
        resolveEntryId: (p) => p.id 
      }
    );

    // Get chat members with user details
    this.defineMethod(
      "getChatMembers",
      "Read",
      async (payload, _ctx) => {
        return this.fetchChatMembers(payload.chatId);
      },
      { 
        schema: getChatMembersSchema,
        resolveEntryId: (p) => p.chatId 
      }
    );

    // Invite user to chat by userId
    this.defineMethod(
      "inviteUser",
      "Moderate",
      async (payload, _ctx) => {
        // Add or update membership (single atomic operation)
        await this.prisma.chatMember.upsert({
          where: {
            chatId_userId: { chatId: payload.id, userId: payload.userId },
          },
          update: { level: payload.level },
          create: {
            chatId: payload.id,
            userId: payload.userId,
            level: payload.level,
          },
        });

        // Emit member update to all subscribers
        await this.emitMemberUpdate(payload.id);

        return { id: payload.id };
      },
      { 
        schema: inviteUserSchema,
        resolveEntryId: (p) => p.id 
      }
    );

    // Invite user to chat by username
    this.defineMethod(
      "inviteByName",
      "Moderate",
      async (payload, _ctx) => {
        // Look up user by name
        const user = await this.prisma.user.findUnique({
          where: { name: payload.userName },
          select: { id: true },
        });

        if (!user) {
          return { error: "user_not_found" as const };
        }

        // Add or update membership
        await this.prisma.chatMember.upsert({
          where: {
            chatId_userId: { chatId: payload.chatId, userId: user.id },
          },
          update: { level: payload.level },
          create: {
            chatId: payload.chatId,
            userId: user.id,
            level: payload.level,
          },
        });

        // Emit member update to all subscribers
        await this.emitMemberUpdate(payload.chatId);

        return { id: payload.chatId };
      },
      { 
        schema: inviteByNameSchema,
        resolveEntryId: (p) => p.chatId 
      }
    );

    // Remove user from chat
    this.defineMethod(
      "removeUser",
      "Moderate",
      async (payload, _ctx) => {
        await this.prisma.chatMember.delete({
          where: {
            chatId_userId: { chatId: payload.id, userId: payload.userId },
          },
        });

        // Emit member update to all subscribers
        await this.emitMemberUpdate(payload.id);

        return { id: payload.id };
      },
      { 
        schema: removeUserSchema,
        resolveEntryId: (p) => p.id 
      }
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

        // Emit member update to all subscribers
        await this.emitMemberUpdate(payload.id);

        return { id: payload.id };
      },
      { 
        schema: leaveSchema,
        resolveEntryId: (p) => p.id 
      }
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
    }, { schema: listMyChatsSchema });

    // Delete chat
    this.defineMethod(
      "deleteChat",
      "Admin",
      async (payload, _ctx) => {
        await this.prisma.chat.delete({ where: { id: payload.id } });
        this.emitUpdate(payload.id, {
          id: payload.id,
          deleted: true,
        } as Partial<Chat>);
        return { id: payload.id, deleted: true as const };
      },
      { 
        schema: deleteChatSchema,
        resolveEntryId: (p) => p.id 
      }
    );
  }
}

import type { User, Prisma, PrismaClient } from "@project/db";
import type { UserServiceMethods, AccessLevel } from "@project/shared";
import { BaseService, type QuickdrawSocket } from "@fitzzero/quickdraw-core/server";

export class UserService extends BaseService<
  User,
  Prisma.UserCreateInput,
  Prisma.UserUpdateInput,
  UserServiceMethods
> {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({ serviceName: "userService", hasEntryACL: false });
    this.prisma = prisma;
    this.setDelegate(prisma.user);
    this.initMethods();
  }

  // Users can access their own data
  protected override checkAccess(
    userId: string,
    entryId: string,
    _requiredLevel: AccessLevel,
    _socket: QuickdrawSocket
  ): boolean {
    return userId === entryId;
  }

  private initMethods(): void {
    // Get current user
    this.defineMethod("getMe", "Read", async (_payload, ctx) => {
      if (!ctx.userId) return null;
      
      const user = await this.prisma.user.findUnique({
        where: { id: ctx.userId },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          serviceAccess: true,
        },
      });

      if (!user) return null;

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        serviceAccess: user.serviceAccess as Record<string, AccessLevel> | null,
      };
    });

    // Update user profile
    this.defineMethod(
      "updateUser",
      "Read",
      async (payload, ctx) => {
        // Users can only update themselves unless they have service-level access
        if (payload.id !== ctx.userId && !ctx.serviceAccess.userService) {
          throw new Error("Cannot update other users");
        }

        const updated = await this.prisma.user.update({
          where: { id: payload.id },
          data: {
            name: payload.data.name,
            image: payload.data.image,
          },
          select: {
            id: true,
            email: true,
            name: true,
            image: true,
          },
        });

        // Emit update to subscribers
        this.emitUpdate(payload.id, updated);

        return updated;
      },
      { resolveEntryId: (p) => p.id }
    );
  }
}

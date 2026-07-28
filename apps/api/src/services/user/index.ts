import type { User, Prisma, PrismaClient } from "@project/db";
import type { UserDTO, UserServiceMethods, AccessLevel } from "@project/shared";
import { BaseService, type QuickdrawSocket } from "@fitzzero/quickdraw-core/server";
import { z } from "zod";

// Zod schemas for validation
const updateUserSchema = z.object({
  id: z.string().cuid("Invalid user ID"),
  data: z.object({
    name: z.string().min(1).max(50).optional(),
    image: z.string().url("Invalid image URL").optional(),
  }),
});

// Admin schema - defines fields available for admin CRUD
const adminUserSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  image: z.string().url().optional(),
  serviceAccess: z.record(z.string(), z.enum(["Public", "Read", "Moderate", "Admin"])).optional(),
});

export class UserService extends BaseService<
  User,
  Prisma.UserCreateInput,
  Prisma.UserUpdateInput,
  UserServiceMethods,
  Record<string, never>,
  UserDTO
> {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    super({ serviceName: "userService", hasEntryACL: false });
    this.prisma = prisma;
    this.setDelegate(prisma.user);
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
      schema: adminUserSchema,
      displayName: "Users",
      tableColumns: ["id", "email", "name", "createdAt"],
      // serviceAccess is exposed but handled by custom UI in admin sidebar:
      // editable via custom component, raw JSON hidden from the table
      fieldOverrides: {
        serviceAccess: {
          editable: true,
          showInTable: false,
          label: "Service Access",
        },
      },
    });
  }

  // Wire shape: the public profile + protected fields (see below)
  protected override toDto(user: User): UserDTO {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      serviceAccess: user.serviceAccess as Record<string, AccessLevel> | null,
    };
  }

  // Users can access their own data
  protected override checkAccess(
    userId: string,
    entryId: string,
    requiredLevel: AccessLevel,
    _socket: QuickdrawSocket,
  ): boolean {
    // Any authenticated user can read any profile (for profile viewing)
    if (requiredLevel === "Read") {
      return true;
    }
    // For write operations, only self-access
    return userId === entryId;
  }

  // Protected fields (of the wire DTO) that non-elevated subscribers won't
  // receive — live emits strip these for everyone outside the :full room
  protected override getProtectedFields(): (keyof UserDTO)[] {
    return ["email", "serviceAccess"];
  }

  private initMethods(): void {
    // Get current user
    this.defineMethod(
      "getMe",
      "Read",
      async (_payload, ctx) => {
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
      },
      { schema: z.object({}) },
    );

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
      {
        schema: updateUserSchema,
        resolveEntryId: (p) => p.id,
      },
    );

    // Fail fast at construction if the method map and definitions drift
    this.verifyAllMethods(["getMe", "updateUser"]);
  }
}

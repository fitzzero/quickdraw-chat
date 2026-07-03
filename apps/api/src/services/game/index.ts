import type { GameWorld, Prisma, PrismaClient } from "@project/db";
import type {
  AccessLevel,
  GameBootstrap,
  GameDeathEvent,
  GameServiceChannels,
  GameServiceMethods,
} from "@project/shared";
import { GAME_EVENTS, GLOBAL_WORLD_ID, GAME_TICK_RATE, serviceRoom } from "@project/shared";
import { BaseService, type QuickdrawSocket } from "@fitzzero/quickdraw-core/server";
import { z } from "zod";
import { GameWorldSim, type GameTunables } from "./world.js";
import { GameLoop } from "./loop.js";

// Zod schemas for validation
const worldScopedSchema = z.object({
  worldId: z.string().min(1),
});

const getWorldSchema = z.object({
  slug: z.string().min(1).max(64),
});

const gameInputSchema = z.object({
  seq: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  dx: z.number().finite(),
  dy: z.number().finite(),
  boost: z.boolean(),
});

// Admin schema - defines fields available for admin CRUD
const adminGameWorldSchema = z.object({
  slug: z.string(),
  name: z.string(),
  chatId: z.string().nullable(),
});

/**
 * GameService — the real-time game server for the demo snake world.
 *
 * Commands (join/respawn/leave) are ordinary typed+ACL'd methods, callable
 * identically from React and from the Godot client. The high-frequency
 * traffic uses quickdraw channels: client input arrives on the "input"
 * channel (fire-and-forget, token-bucketed), world snapshots go out as
 * volatile broadcasts to the world's service room at GAME_TICK_RATE.
 *
 * The simulation itself (GameWorldSim) is pure and in-memory — the database
 * only sees world/chat bootstrap and throttled score writes, never the tick
 * path. See .claude/rules/game-patterns.md.
 */
export class GameService extends BaseService<
  GameWorld,
  Prisma.GameWorldCreateInput,
  Prisma.GameWorldUpdateInput,
  GameServiceMethods,
  GameServiceChannels
> {
  private readonly prisma: PrismaClient;
  public readonly sim: GameWorldSim;
  public readonly loop: GameLoop;

  // socketId -> userId for players who joined via that socket; a player is
  // removed from the sim when their last joined socket disconnects.
  private readonly joinedSockets = new Map<string, string>();
  private readonly socketsByUser = new Map<string, Set<string>>();

  constructor(
    prisma: PrismaClient,
    options?: { simSeed?: number; tunables?: Partial<GameTunables> },
  ) {
    super({ serviceName: "gameService", hasEntryACL: false });
    this.prisma = prisma;
    this.setDelegate(prisma.gameWorld);

    this.sim = new GameWorldSim({ seed: options?.simSeed, tunables: options?.tunables });
    const room = serviceRoom("gameService", GLOBAL_WORLD_ID);
    this.loop = new GameLoop({
      sim: this.sim,
      emitVolatile: (event, data) => this.emitToRoomVolatile(room, event, data),
      emitReliable: (event, data) => this.emitToRoom(room, event, data),
      onDeath: (death) => this.persistScore(death),
    });

    this.initMethods();
    this.initChannels();
    this.installAdmin();
  }

  public startLoop(): void {
    this.loop.start();
  }

  public stopLoop(): void {
    this.loop.stop();
  }

  // Worlds are public-read for any authenticated user: subscription gives
  // room membership (snapshots + chat events), which in turn gates the
  // input channel. Writes still require service-level access.
  protected override checkAccess(
    _userId: string,
    _entryId: string,
    requiredLevel: AccessLevel,
    _socket: unknown,
  ): boolean {
    return requiredLevel === "Read";
  }

  // Remove the player when their last joined socket goes away
  public override unsubscribeSocket(socket: QuickdrawSocket): void {
    super.unsubscribeSocket(socket);
    const userId = this.joinedSockets.get(socket.id);
    if (!userId) return;

    this.joinedSockets.delete(socket.id);
    const sockets = this.socketsByUser.get(userId);
    sockets?.delete(socket.id);
    if (sockets && sockets.size > 0) return;

    this.socketsByUser.delete(userId);
    if (this.sim.removePlayer(userId)) {
      this.emitToRoom(serviceRoom("gameService", GLOBAL_WORLD_ID), GAME_EVENTS.playerLeft, {
        id: userId,
      });
    }
  }

  private trackJoin(socketId: string, userId: string): void {
    this.joinedSockets.set(socketId, userId);
    let sockets = this.socketsByUser.get(userId);
    if (!sockets) this.socketsByUser.set(userId, (sockets = new Set()));
    sockets.add(socketId);
  }

  private untrackLeave(userId: string): void {
    const sockets = this.socketsByUser.get(userId);
    if (sockets) {
      for (const socketId of sockets) this.joinedSockets.delete(socketId);
    }
    this.socketsByUser.delete(userId);
  }

  /** Score writes happen off the tick path; failures are logged, never thrown. */
  private persistScore(death: GameDeathEvent): void {
    void (async () => {
      await this.prisma.gameScore.upsert({
        where: { worldId_userId: { worldId: GLOBAL_WORLD_ID, userId: death.id } },
        update: {},
        create: { worldId: GLOBAL_WORLD_ID, userId: death.id, bestLength: death.len },
      });
      await this.prisma.gameScore.updateMany({
        where: { worldId: GLOBAL_WORLD_ID, userId: death.id, bestLength: { lt: death.len } },
        data: { bestLength: death.len },
      });
    })().catch((error: unknown) => {
      this.logger.warn("Failed to persist game score", {
        userId: death.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private initMethods(): void {
    this.initJoinMethod();
    this.initSessionMethods();
  }

  private initJoinMethod(): void {
    this.defineMethod(
      "joinGame",
      "Read",
      async (payload, ctx): Promise<GameBootstrap> => {
        if (!ctx.userId) throw new Error("Authentication required");
        if (payload.worldId !== GLOBAL_WORLD_ID) throw new Error("Unknown world");

        const [user, world] = await Promise.all([
          this.prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } }),
          this.findById(GLOBAL_WORLD_ID),
        ]);

        const { meta, isNew } = this.sim.addPlayer(ctx.userId, user?.name ?? null);
        this.trackJoin(ctx.socketId, ctx.userId);

        // Membership in the world chat (idempotent). The chat overlay
        // subscribes via chatService as usual.
        if (world?.chatId) {
          await this.prisma.chatMember.upsert({
            where: { chatId_userId: { chatId: world.chatId, userId: ctx.userId } },
            update: {},
            create: { chatId: world.chatId, userId: ctx.userId, level: "Read" },
          });
        }

        if (isNew) {
          this.emitToRoom(
            serviceRoom("gameService", GLOBAL_WORLD_ID),
            GAME_EVENTS.playerJoined,
            meta,
          );
        }

        const state = this.sim.getBootstrapState();
        return {
          worldId: GLOBAL_WORLD_ID,
          chatId: world?.chatId ?? null,
          tick: this.sim.tick,
          tickRate: GAME_TICK_RATE,
          bounds: { w: this.sim.tunables.worldWidth, h: this.sim.tunables.worldHeight },
          you: meta,
          players: state.players,
          snaps: state.snaps,
          food: state.food,
        };
      },
      { schema: worldScopedSchema },
    );
  }

  private initSessionMethods(): void {
    this.defineMethod(
      "respawn",
      "Read",
      (payload, ctx) => {
        if (!ctx.userId) throw new Error("Authentication required");
        if (payload.worldId !== GLOBAL_WORLD_ID) throw new Error("Unknown world");
        this.sim.respawn(ctx.userId);
        return Promise.resolve({ ok: true as const });
      },
      { schema: worldScopedSchema },
    );

    this.defineMethod(
      "leaveGame",
      "Read",
      (payload, ctx) => {
        if (!ctx.userId) throw new Error("Authentication required");
        if (payload.worldId !== GLOBAL_WORLD_ID) throw new Error("Unknown world");
        this.untrackLeave(ctx.userId);
        if (this.sim.removePlayer(ctx.userId)) {
          this.emitToRoom(serviceRoom("gameService", GLOBAL_WORLD_ID), GAME_EVENTS.playerLeft, {
            id: ctx.userId,
          });
        }
        return Promise.resolve({ ok: true as const });
      },
      { schema: worldScopedSchema },
    );

    this.defineMethod(
      "getWorld",
      "Public",
      async (payload) => {
        const world = await this.prisma.gameWorld.findUnique({
          where: { slug: payload.slug },
          select: { id: true, name: true, chatId: true },
        });
        return world ?? null;
      },
      { schema: getWorldSchema },
    );
  }

  private initChannels(): void {
    // Client input at ~tick rate. Fire-and-forget: invalid/unauthorized/
    // excess frames are dropped silently; the token bucket replaces the
    // global rate limiter for this event.
    this.defineChannel(
      "input",
      "Read",
      (payload, ctx) => {
        this.sim.applyInput(ctx.userId, payload);
      },
      {
        schema: gameInputSchema,
        ratePerSecond: GAME_TICK_RATE * 1.5,
        burst: GAME_TICK_RATE * 3,
        requireRoom: () => serviceRoom("gameService", GLOBAL_WORLD_ID),
      },
    );
  }

  private installAdmin(): void {
    this.installAdminMethods({
      expose: { list: true, get: true, update: true, delete: false, create: false },
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
      schema: adminGameWorldSchema,
      displayName: "Game Worlds",
      tableColumns: ["id", "slug", "name", "createdAt"],
    });
  }
}

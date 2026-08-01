import type { GameWorld, Prisma, PrismaClient } from "@project/db";
import type {
  AccessLevel,
  GameBootstrap,
  GameDeathEvent,
  GameServiceChannels,
  GameServiceMethods,
  HighScoreEntry,
  WorldBootstrap,
} from "@project/shared";
import { GAME_EVENTS, GLOBAL_WORLD_ID, GAME_TICK_RATE, serviceRoom } from "@project/shared";
import { BaseService, type QuickdrawSocket } from "@fitzzero/quickdraw-core/server";
import { z } from "zod";
import { GameWorldSim, isNpcId, type GameTunables } from "./world.js";
import { GameLoop, type GameLoopDeps } from "./loop.js";

// Zod schemas for validation
const worldScopedSchema = z.object({
  worldId: z.string().min(1),
});

const getWorldSchema = z.object({
  slug: z.string().min(1).max(64),
});

const highScoresSchema = z.object({
  worldId: z.string().min(1),
  limit: z.number().int().min(1).max(100).optional(),
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

  // Users who joined the game (spawned). Presence is anchored on ROOM
  // membership, not a specific socket: a player typically has two sockets
  // (the React page + the Godot client) and either one keeps them alive.
  private readonly playingUsers = new Set<string>();

  constructor(
    prisma: PrismaClient,
    options?: {
      simSeed?: number;
      tunables?: Partial<GameTunables>;
      /** Bench/observability hook — see GameLoopDeps.onTick. */
      onTick?: GameLoopDeps["onTick"];
    },
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
      // Spectators (pre-game dialog) keep the NPC world alive
      hasAudience: () => (this.subscribers.get(GLOBAL_WORLD_ID)?.size ?? 0) > 0,
      ...(options?.onTick ? { onTick: options.onTick } : {}),
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

  // Remove the player only when NO subscribed socket of theirs remains in
  // the world room. Covers both leave paths: disconnect (unsubscribeSocket)
  // and explicit unsubscribe. The base class removes the departing socket
  // from `subscribers` before these hooks run, so a plain scan suffices.
  public override unsubscribeSocket(socket: QuickdrawSocket): void {
    super.unsubscribeSocket(socket);
    this.maybeRemovePlayer(socket.userId);
  }

  public override unsubscribe(entryId: string, socket: QuickdrawSocket): void {
    super.unsubscribe(entryId, socket);
    if (entryId === GLOBAL_WORLD_ID) this.maybeRemovePlayer(socket.userId);
  }

  private maybeRemovePlayer(userId: string | undefined): void {
    if (!userId || !this.playingUsers.has(userId)) return;
    const roomSockets = this.subscribers.get(GLOBAL_WORLD_ID);
    if (roomSockets) {
      for (const socket of roomSockets) {
        // Another socket anchors them
        if (socket.userId === userId) return;
      }
    }
    this.playingUsers.delete(userId);
    if (this.sim.removePlayer(userId)) {
      this.emitToRoom(serviceRoom("gameService", GLOBAL_WORLD_ID), GAME_EVENTS.playerLeft, {
        id: userId,
      });
    }
  }

  /** Score writes happen off the tick path; failures are logged, never thrown. */
  private persistScore(death: GameDeathEvent): void {
    // Bots have no User row and no high scores
    if (isNpcId(death.id)) return;
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
        this.playingUsers.add(ctx.userId);

        await this.ensureChatMembership(world?.chatId, ctx.userId);

        if (isNew) {
          this.emitToRoom(
            serviceRoom("gameService", GLOBAL_WORLD_ID),
            GAME_EVENTS.playerJoined,
            meta,
          );
        }

        return { ...this.buildWorldBootstrap(world?.chatId ?? null), you: meta };
      },
      { schema: worldScopedSchema },
    );

    // Spectate entry: full world state without spawning. The web wrapper
    // boots Godot into this; the pre-game dialog's joinGame (from the React
    // socket) is what actually spawns the player. Authed spectators get
    // world-chat membership (the chat overlay works behind the dialog);
    // ANONYMOUS spectators (signed-out /game visitors) get world-room
    // membership granted here instead — the registry's subscribe path
    // requires auth, but the snapshot/leaderboard streams are public and
    // channels stay auth-gated (core drops anonymous channel input).
    this.defineMethod(
      "watchWorld",
      "Public",
      async (payload, ctx): Promise<WorldBootstrap> => {
        if (payload.worldId !== GLOBAL_WORLD_ID) throw new Error("Unknown world");
        const world = await this.findById(GLOBAL_WORLD_ID);
        if (ctx.userId) {
          await this.ensureChatMembership(world?.chatId, ctx.userId);
        } else {
          this.joinSpectator(ctx.socketId);
        }
        return this.buildWorldBootstrap(world?.chatId ?? null);
      },
      { schema: worldScopedSchema },
    );
  }

  /**
   * World-room membership for an anonymous socket: receives the volatile
   * snapshot + reliable event streams and counts toward `hasAudience` (the
   * NPC world keeps ticking for spectators). Registered in `subscribers` so
   * the standard disconnect cleanup (`unsubscribeSocket`) applies.
   */
  private joinSpectator(socketId: string): void {
    const socket = this.io?.sockets.sockets.get(socketId) as QuickdrawSocket | undefined;
    if (!socket) return;
    void socket.join(serviceRoom("gameService", GLOBAL_WORLD_ID));
    let roomSockets = this.subscribers.get(GLOBAL_WORLD_ID);
    if (!roomSockets) {
      roomSockets = new Set();
      this.subscribers.set(GLOBAL_WORLD_ID, roomSockets);
    }
    roomSockets.add(socket);
  }

  /** Idempotent membership in the world chat (the in-game chat overlay). */
  private async ensureChatMembership(
    chatId: string | null | undefined,
    userId: string,
  ): Promise<void> {
    if (!chatId) return;
    await this.prisma.chatMember.upsert({
      where: { chatId_userId: { chatId, userId } },
      update: {},
      create: { chatId, userId, level: "Read" },
    });
  }

  private buildWorldBootstrap(chatId: string | null): WorldBootstrap {
    const state = this.sim.getBootstrapState();
    return {
      worldId: GLOBAL_WORLD_ID,
      chatId,
      tick: this.sim.tick,
      tickRate: GAME_TICK_RATE,
      bounds: { w: this.sim.tunables.worldWidth, h: this.sim.tunables.worldHeight },
      players: state.players,
      snaps: state.snaps,
      food: state.food,
    };
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
        this.playingUsers.delete(ctx.userId);
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
    this.initScoreMethods();
  }

  private initScoreMethods(): void {
    this.defineMethod(
      "getMyBest",
      "Read",
      async (payload, ctx) => {
        if (!ctx.userId) throw new Error("Authentication required");
        if (payload.worldId !== GLOBAL_WORLD_ID) throw new Error("Unknown world");
        const score = await this.prisma.gameScore.findUnique({
          where: { worldId_userId: { worldId: GLOBAL_WORLD_ID, userId: ctx.userId } },
          select: { bestLength: true },
        });
        return { bestLength: score?.bestLength ?? 0 };
      },
      { schema: worldScopedSchema },
    );

    // Public: powers the /scores page for signed-out visitors too.
    // NPCs never persist scores, so no filtering is needed here.
    this.defineMethod(
      "getHighScores",
      "Public",
      async (payload): Promise<HighScoreEntry[]> => {
        if (payload.worldId !== GLOBAL_WORLD_ID) throw new Error("Unknown world");
        const rows = await this.prisma.gameScore.findMany({
          where: { worldId: GLOBAL_WORLD_ID },
          orderBy: { bestLength: "desc" },
          take: Math.min(payload.limit ?? 25, 100),
          include: { user: { select: { name: true, image: true, isGuest: true } } },
        });
        return rows.map((row) => ({
          userId: row.userId,
          name: row.user.name,
          image: row.user.image,
          isGuest: row.user.isGuest,
          bestLength: row.bestLength,
        }));
      },
      { schema: highScoresSchema },
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

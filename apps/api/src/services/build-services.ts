/**
 * One place where the service graph is wired.
 *
 * Four roots compose these services — the production server, the integration
 * test server, the bench server, and the MCP server — and they had drifted
 * apart. Construct them here so a new service, or a new constructor argument,
 * lands in every root at once. Each root still decides which of the returned
 * services it registers.
 *
 * Construction is cheap and side-effect free: nothing here starts a timer or
 * opens a connection, and PushService is a no-op without VAPID keys.
 */

import type { PrismaClient } from "@project/db";
import { UserService } from "./user/index.js";
import { ChatService } from "./chat/index.js";
import { MessageService } from "./message/index.js";
import { DocumentService } from "./document/index.js";
import { PushService, type PushServiceOptions } from "./push-subscription/index.js";
// ── quickdraw-game:start ──
import { GameService } from "./game/index.js";
import { DefinitionService } from "./definition/index.js";
import type { GameTunables } from "./game/world.js";
import type { GameLoopDeps } from "./game/loop.js";
// ── quickdraw-game:end ──

// ── quickdraw-game:start ──
export interface GameServiceOptions {
  simSeed?: number;
  tunables?: Partial<GameTunables>;
  /** Bench/observability hook — see GameLoopDeps.onTick. */
  onTick?: GameLoopDeps["onTick"];
}
// ── quickdraw-game:end ──

export interface BuildServicesOptions {
  /** Push transport / online-check injection. Omit to disable sends. */
  push?: PushServiceOptions;
  // ── quickdraw-game:start ──
  /** Seed, tunables and tick hook for the game sim. The loop is never started here. */
  game?: GameServiceOptions;
  // ── quickdraw-game:end ──
}

/**
 * A type alias rather than an interface on purpose: core's
 * `createQuickdrawServer` takes `Record<string, BaseServiceInstance>`, and only
 * a type alias carries the implicit index signature that satisfies it.
 */
export type BuiltServices = {
  userService: UserService;
  chatService: ChatService;
  messageService: MessageService;
  documentService: DocumentService;
  pushService: PushService;
  // ── quickdraw-game:start ──
  gameService: GameService;
  definitionService: DefinitionService;
  // ── quickdraw-game:end ──
};

/** Construct every service against one Prisma client. */
export function buildServices(
  prisma: PrismaClient,
  options: BuildServicesOptions = {},
): BuiltServices {
  const chatService = new ChatService(prisma);
  const pushService = new PushService(prisma, options.push);

  return {
    userService: new UserService(prisma),
    chatService,
    messageService: new MessageService(prisma, chatService, pushService),
    documentService: new DocumentService(prisma),
    pushService,
    // ── quickdraw-game:start ──
    gameService: new GameService(prisma, options.game),
    definitionService: new DefinitionService(prisma),
    // ── quickdraw-game:end ──
  };
}

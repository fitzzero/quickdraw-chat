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
import { userService } from "./user/index.js";
import { chatService as chatServiceDef } from "./chat/index.js";
import { messageService } from "./message/index.js";
import { documentService } from "./document/index.js";
import {
  pushService as pushServiceDef,
  type PushServiceOptions,
} from "./push-subscription/index.js";
// ── quickdraw-game:start ──
import { gameService } from "./game/index.js";
import { definitionService } from "./definition/index.js";
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
  userService: typeof userService;
  chatService: typeof chatServiceDef;
  messageService: typeof messageService;
  documentService: typeof documentService;
  pushService: typeof pushServiceDef;
  // ── quickdraw-game:start ──
  gameService: typeof gameService;
  definitionService: typeof definitionService;
  // ── quickdraw-game:end ──
};

/** Construct every service against one Prisma client. */
export function buildServices(
  prisma: PrismaClient,
  options: BuildServicesOptions = {},
): BuiltServices {
  // quickdraw-migrate: review [server] the 4.x service was constructed here (new ChatService(...)): it is the object chatServiceDef now; pass it in qd.createServer({ services: [...] })
  const chatService = chatServiceDef;
  // quickdraw-migrate: review [server] the 4.x service was constructed here (new PushService(...)): it is the object pushServiceDef now; pass it in qd.createServer({ services: [...] })
  const pushService = pushServiceDef;

  return {
    // quickdraw-migrate: review [server] the 4.x service was constructed here (new UserService(...)): it is the object userService now; pass it in qd.createServer({ services: [...] })
    userService: userService,
    chatService,
    // quickdraw-migrate: review [server] the 4.x service was constructed here (new MessageService(...)): it is the object messageService now; pass it in qd.createServer({ services: [...] })
    messageService: messageService,
    // quickdraw-migrate: review [server] the 4.x service was constructed here (new DocumentService(...)): it is the object documentService now; pass it in qd.createServer({ services: [...] })
    documentService: documentService,
    pushService,
    // ── quickdraw-game:start ──
    // quickdraw-migrate: review [server] the 4.x service was constructed here (new GameService(...)): it is the object gameService now; pass it in qd.createServer({ services: [...] })
    gameService: gameService,
    // quickdraw-migrate: review [server] the 4.x service was constructed here (new DefinitionService(...)): it is the object definitionService now; pass it in qd.createServer({ services: [...] })
    definitionService: definitionService,
    // ── quickdraw-game:end ──
  };
}

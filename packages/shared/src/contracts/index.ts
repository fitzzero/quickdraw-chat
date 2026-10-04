// The app's contracts, written by @fitzzero/quickdraw-codemod. The web client is
// built from `contracts` (`createQuickdrawClient(contracts)`), keyed by service
// name so every 4.x call site keeps its name: `qd.projectService.getProject`.

import { chatContract } from "./chat.js";
import { documentContract } from "./document.js";
import { messageContract } from "./message.js";
import { pushContract } from "./push.js";
import { userContract } from "./user.js";
// ── quickdraw-game:start ──
import { definitionContract } from "./definition.js";
import { gameContract } from "./game.js";
// ── quickdraw-game:end ──

export { chatContract, documentContract, messageContract, pushContract, userContract };
// ── quickdraw-game:start ──
export { definitionContract, gameContract };
// ── quickdraw-game:end ──

export const contracts = {
  chatService: chatContract,
  documentService: documentContract,
  messageService: messageContract,
  pushService: pushContract,
  userService: userContract,
  // ── quickdraw-game:start ──
  definitionService: definitionContract,
  gameService: gameContract,
  // ── quickdraw-game:end ──
};

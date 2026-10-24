// The app's contracts. The web client is built from `contracts`
// (`createQuickdrawClient(contracts)`), keyed by service name, so a member
// reads as the server names it: `qd.chatService.createChat`.

import { chatContract } from "./chat.js";
import { documentContract } from "./document.js";
import { messageContract } from "./message.js";
import { pushContract } from "./push.js";
import { userContract } from "./user.js";
// ── quickdraw-game:start ──
import { definitionContract } from "./definition.js";
import { gameContract, worldSnapshotSchema } from "./game.js";
// ── quickdraw-game:end ──

export { chatContract, documentContract, messageContract, pushContract, userContract };
// ── quickdraw-game:start ──
// The schema of what a world stream item decodes to (SnapshotDecoder)
export { definitionContract, gameContract, worldSnapshotSchema };
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

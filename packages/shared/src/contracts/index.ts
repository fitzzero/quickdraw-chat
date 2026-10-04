// The app's contracts, written by @fitzzero/quickdraw-codemod. The web client is
// built from `contracts` (`createQuickdrawClient(contracts)`), keyed by service
// name so every 4.x call site keeps its name: `qd.projectService.getProject`.

import { chatContract } from "./chat.js";
import { definitionContract } from "./definition.js";
import { documentContract } from "./document.js";
import { gameContract } from "./game.js";
import { messageContract } from "./message.js";
import { pushContract } from "./push.js";
import { userContract } from "./user.js";

export {
  chatContract,
  definitionContract,
  documentContract,
  gameContract,
  messageContract,
  pushContract,
  userContract,
};

export const contracts = {
  chatService: chatContract,
  definitionService: definitionContract,
  documentService: documentContract,
  gameService: gameContract,
  messageService: messageContract,
  pushService: pushContract,
  userService: userContract,
};

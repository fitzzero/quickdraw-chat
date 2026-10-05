import { createQuickdrawClient } from "@fitzzero/quickdraw-core/client";
import { contracts } from "@project/shared";

/**
 * The app's one typed client, from the contracts: `qd.<service>.<member>`
 * for every method, collection and event (`qd.chatService.myChats.useCollection`,
 * `qd.messageService.postMessage.useMutation`, ...). `<QuickdrawProvider client={qd}>`
 * in `providers/index.tsx` gives it its connection; who that connection acts
 * for is `useQuickdraw()` from `@fitzzero/quickdraw-core/client`.
 */
export const qd = createQuickdrawClient(contracts);

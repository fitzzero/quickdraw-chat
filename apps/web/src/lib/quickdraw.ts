import { createQuickdrawClient } from "@fitzzero/quickdraw-core/client";
import { contracts } from "@project/shared";

/**
 * The app's one typed client, from the contracts: `qd.<service>.<member>`
 * for every method, collection and event (`qd.chatService.myChats.useCollection`,
 * `qd.messageService.postMessage.useMutation`, ...). `<QuickdrawProvider client={qd}>`
 * in `providers/index.tsx` gives it its connection.
 */
export const qd = createQuickdrawClient(contracts);

// The connection's state (who the socket acts for, their grants, whether the
// server's hello has arrived), exported beside `qd` so that a module mock of
// this file stands in for both.
// quickdraw-5.0 finding: createMockClient stands in for `qd` only; useQuickdraw() still throws outside a real <QuickdrawProvider>, so a component that reads the signed-in user cannot render on the mock client unless the app re-exports useQuickdraw from the module it mocks
export { useQuickdraw } from "@fitzzero/quickdraw-core/client";

import { createQuickdrawClient } from "@fitzzero/quickdraw-core/client";
import { contracts } from "@project/shared";

// Written by @fitzzero/quickdraw-codemod: one typed client for the app, from the
// contracts. Pass it to <QuickdrawProvider client={qd} url={...}>.
export const qd = createQuickdrawClient(contracts);

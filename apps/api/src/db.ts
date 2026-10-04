import { trackPrisma } from "@fitzzero/quickdraw-core/prisma";
import { prisma } from "@project/db";

// Written by @fitzzero/quickdraw-codemod. Every write through `db` is tracked,
// so subscribers see it. Apply trackPrisma last, after any other client extension.
export const db = trackPrisma(prisma);

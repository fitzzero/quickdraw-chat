import type { EntityOf } from "@fitzzero/quickdraw-core";
import type { documentContract } from "../contracts/document.js";

// ============================================================================
// Document Service Types: named views of the document contract
// (contracts/document.ts), the JSON access-list example
// ============================================================================

/** Wire shape of a document: the contract's entity, its access list included. */
export type DocumentDTO = EntityOf<typeof documentContract>;

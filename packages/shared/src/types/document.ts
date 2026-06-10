import type { AccessLevel, ACL } from "./access.js";

// ============================================================================
// Document Service Methods - Example of simple JSON ACL pattern
// ============================================================================

export interface DocumentDTO {
  id: string;
  title: string;
  content: string;
  ownerId: string;
  acl: ACL | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentServiceMethods {
  createDocument: {
    payload: { title: string; content?: string };
    response: { id: string };
  };
  getDocument: {
    payload: { id: string };
    response: DocumentDTO | null;
  };
  updateDocument: {
    payload: { id: string; title?: string; content?: string };
    response: DocumentDTO | null;
  };
  deleteDocument: {
    payload: { id: string };
    response: { id: string; deleted: true };
  };
  listMyDocuments: {
    payload: { page?: number; pageSize?: number };
    response: DocumentDTO[];
  };
  shareDocument: {
    payload: { id: string; userId: string; level: AccessLevel };
    response: { id: string };
  };
  unshareDocument: {
    payload: { id: string; userId: string };
    response: { id: string };
  };
}

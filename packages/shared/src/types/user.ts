import type { AccessLevel } from "./access.js";

// ============================================================================
// User Service Types
// ============================================================================

/**
 * Wire shape of a user entity (subscription payloads + emitUpdate).
 * `email` and `serviceAccess` are protected fields — stripped for
 * subscribers without elevated access.
 */
export interface UserDTO {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  serviceAccess: Record<string, AccessLevel> | null;
}

export interface UserServiceMethods {
  updateUser: {
    payload: {
      id: string;
      data: {
        name?: string | null;
        image?: string | null;
      };
    };
    response: {
      id: string;
      email: string;
      name: string | null;
      image: string | null;
    };
  };
  getMe: {
    payload: Record<string, never>;
    response: {
      id: string;
      email: string;
      name: string | null;
      image: string | null;
      serviceAccess: Record<string, AccessLevel> | null;
    } | null;
  };
}

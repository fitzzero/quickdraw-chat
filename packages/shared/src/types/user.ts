import type { AccessLevel } from "./access.js";

// ============================================================================
// User Service Methods
// ============================================================================

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

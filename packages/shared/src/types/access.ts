// ============================================================================
// Access Control Types
// ============================================================================

export type AccessLevel = "Public" | "Read" | "Moderate" | "Admin";

export interface ACE {
  userId: string;
  level: AccessLevel;
}

export type ACL = ACE[];

// ============================================================================
// Service Response Types
// ============================================================================

export type ServiceResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string; code?: number };

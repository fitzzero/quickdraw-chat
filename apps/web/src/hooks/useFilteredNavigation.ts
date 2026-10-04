"use client";

import * as React from "react";
import { siteNavigation, type NavItem } from "../lib/navigation";
import type { AccessLevel } from "@project/shared";
import { qd, useQuickdraw } from "../lib/quickdraw";
/**
 * Access levels that grant visibility to a service.
 * Read or higher means the user can see the service in navigation.
 */
const VISIBLE_ACCESS_LEVELS: AccessLevel[] = ["Read", "Moderate", "Admin"];

/**
 * Check if an access level grants visibility to a service.
 */
function hasVisibleAccess(level: AccessLevel | undefined): boolean {
  return level !== undefined && VISIBLE_ACCESS_LEVELS.includes(level);
}

/**
 * Hook to get navigation items filtered by the user's service access.
 *
 * Items with a `serviceName` will only be shown if the user has Read or higher
 * access to that service. Items without a `serviceName` are always shown
 * (e.g., Home).
 *
 * Uses the grants the server's hello (and later `qd:access` pushes) gave the
 * connection, which include the defaults merged from SERVICE_DEFAULT_ACCESS,
 * rather than the raw database value.
 *
 * @returns Object containing filtered navigation, loading state, and service access map
 *
 * @example
 * ```tsx
 * const { navigation, isLoading, serviceAccess } = useFilteredNavigation();
 *
 * // navigation only contains items the user has access to
 * navigation.map(item => <NavItem key={item.id} item={item} />)
 * ```
 */
export function useFilteredNavigation(): {
  /** Filtered navigation items based on user's service access */
  navigation: NavItem[];
  /** Whether the server's hello (who the user is) has not arrived yet */
  isLoading: boolean;
  /** Service access map (includes merged defaults from server) */
  serviceAccess: Record<string, AccessLevel> | null;
  /** Check if user has access to a specific service */
  hasServiceAccess: (serviceName: string) => boolean;
} {
  // The connection's grants: these include SERVICE_DEFAULT_ACCESS, merged by the server
  const { userId, hello, serviceAccess: grants } = useQuickdraw();
  const isKnown = hello !== null;

  // Guest sessions hide `hideForGuests` items. Structural probe so the hook
  // stays generic — the field only exists when the guest-auth feature does.
  const { data: ownUser } = qd.userService.useEntity(userId);
  const isGuestSession = (ownUser as { isGuest?: boolean } | undefined)?.isGuest === true;

  // No grants at all reads as null, as an empty map would hide every item
  const serviceAccess = React.useMemo<Record<string, AccessLevel> | null>(() => {
    if (!grants || Object.keys(grants).length === 0) return null;
    return { ...grants };
  }, [grants]);

  // Helper to check if user has access to a service
  const hasServiceAccess = React.useCallback(
    (serviceName: string): boolean => {
      if (!serviceAccess) return false;
      return hasVisibleAccess(serviceAccess[serviceName]);
    },
    [serviceAccess],
  );

  // Filter navigation based on service access
  const navigation = React.useMemo<NavItem[]>(() => {
    const items = siteNavigation.filter((item) => !(isGuestSession && item.hideForGuests));

    // If not logged in, only show items that don't require auth
    if (!userId) {
      return items.filter((item) => !item.requireAuth);
    }

    // Until the hello arrives, show ALL items to prevent flash
    if (!isKnown) {
      return items;
    }

    // If no service access (empty defaults), show only items without service restriction
    if (!serviceAccess) {
      return items.filter((item) => !item.serviceName);
    }

    // Filter based on service access
    return items.filter((item) => {
      // Items without serviceName are always shown (e.g., Home)
      if (!item.serviceName) return true;

      // Check if user has Read or higher access to the service
      return hasVisibleAccess(serviceAccess[item.serviceName]);
    });
  }, [userId, isKnown, serviceAccess, isGuestSession]);

  return {
    navigation,
    isLoading: !isKnown,
    serviceAccess,
    hasServiceAccess,
  };
}

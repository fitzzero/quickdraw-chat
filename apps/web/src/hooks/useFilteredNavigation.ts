"use client";

import * as React from "react";
import { useSocket } from "../providers";
import { siteNavigation, type NavItem } from "../lib/navigation";
import type { AccessLevel } from "@project/shared";

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
 * Uses serviceAccess from the socket connection (which includes merged defaults
 * from SERVICE_DEFAULT_ACCESS) rather than the raw database value.
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
  /** Whether socket is still connecting */
  isLoading: boolean;
  /** Service access map (includes merged defaults from server) */
  serviceAccess: Record<string, AccessLevel> | null;
  /** Check if user has access to a specific service */
  hasServiceAccess: (serviceName: string) => boolean;
} {
  // Use serviceAccess from socket - this includes merged SERVICE_DEFAULT_ACCESS from server
  const { userId, isConnected, serviceAccess: socketServiceAccess } = useSocket();

  // Convert to proper type (socket returns it as unknown)
  const serviceAccess = React.useMemo<Record<string, AccessLevel> | null>(() => {
    if (!socketServiceAccess || Object.keys(socketServiceAccess).length === 0) return null;
    return socketServiceAccess as Record<string, AccessLevel>;
  }, [socketServiceAccess]);

  // Helper to check if user has access to a service
  const hasServiceAccess = React.useCallback(
    (serviceName: string): boolean => {
      if (!serviceAccess) return false;
      return hasVisibleAccess(serviceAccess[serviceName]);
    },
    [serviceAccess]
  );

  // Filter navigation based on service access
  const navigation = React.useMemo<NavItem[]>(() => {
    // If not logged in, only show items that don't require auth
    if (!userId) {
      return siteNavigation.filter((item) => !item.requireAuth);
    }

    // If socket is still connecting, show ALL items to prevent flash
    if (!isConnected) {
      return siteNavigation;
    }

    // If no service access (empty defaults), show only items without service restriction
    if (!serviceAccess) {
      return siteNavigation.filter((item) => !item.serviceName);
    }

    // Filter based on service access
    return siteNavigation.filter((item) => {
      // Items without serviceName are always shown (e.g., Home)
      if (!item.serviceName) return true;

      // Check if user has Read or higher access to the service
      return hasVisibleAccess(serviceAccess[item.serviceName]);
    });
  }, [userId, isConnected, serviceAccess]);

  return {
    navigation,
    isLoading: !isConnected,
    serviceAccess,
    hasServiceAccess,
  };
}

"use client";

import * as React from "react";
import { useSocket } from "../providers";
import { useSubscription } from "./useSubscription";
import type { AdminServiceMeta, ServiceResponse } from "@project/shared";

/**
 * Service info for admin navigation.
 * Contains the service name and display name.
 */
export interface AdminServiceInfo {
  serviceName: string;
  displayName: string;
}

/**
 * Known service display names for fallback.
 * Used when adminMeta hasn't been fetched yet.
 */
const SERVICE_DISPLAY_NAMES: Record<string, string> = {
  userService: "Users",
  chatService: "Chats",
  messageService: "Messages",
  documentService: "Documents",
};

/**
 * Hook to get the list of services the current user has admin access to.
 * Reads the user's serviceAccess from their subscription data.
 *
 * @returns Object containing admin services, loading state, and whether user has any admin access
 *
 * @example
 * ```tsx
 * const { adminServices, isLoading, hasAdminAccess } = useAdminServices();
 *
 * if (hasAdminAccess) {
 *   // Show admin link in menu
 * }
 * ```
 */
export function useAdminServices(): {
  adminServices: AdminServiceInfo[];
  isLoading: boolean;
  hasAdminAccess: boolean;
} {
  const { userId, socket, isConnected } = useSocket();
  const { data: user } = useSubscription("userService", userId ?? "");
  const [servicesMeta, setServicesMeta] = React.useState<Map<string, AdminServiceMeta>>(new Map());
  const [isLoadingMeta, setIsLoadingMeta] = React.useState(false);

  // Get services where user has Admin access
  const adminServiceNames = React.useMemo(() => {
    if (!user?.serviceAccess) return [];

    return Object.entries(user.serviceAccess)
      .filter(([_, level]) => level === "Admin")
      .map(([serviceName]) => serviceName);
  }, [user?.serviceAccess]);

  // Fetch metadata for admin services
  React.useEffect(() => {
    if (!socket || !isConnected || adminServiceNames.length === 0) {
      return;
    }

    setIsLoadingMeta(true);

    // Fetch meta for each service
    let completed = 0;
    const newMeta = new Map<string, AdminServiceMeta>();

    adminServiceNames.forEach((serviceName) => {
      socket.emit(
        `${serviceName}:adminMeta`,
        {},
        (response: ServiceResponse<AdminServiceMeta>) => {
          if (response.success) {
            newMeta.set(serviceName, response.data);
          }
          completed++;
          if (completed === adminServiceNames.length) {
            setServicesMeta(newMeta);
            setIsLoadingMeta(false);
          }
        }
      );
    });
  }, [socket, isConnected, adminServiceNames]);

  // Build admin services list with display names
  const adminServices = React.useMemo<AdminServiceInfo[]>(() => {
    return adminServiceNames.map((serviceName) => {
      const meta = servicesMeta.get(serviceName);
      return {
        serviceName,
        displayName:
          meta?.displayName ??
          SERVICE_DISPLAY_NAMES[serviceName] ??
          serviceName.replace(/Service$/i, ""),
      };
    });
  }, [adminServiceNames, servicesMeta]);

  const isLoading = !user || isLoadingMeta;

  return {
    adminServices,
    isLoading,
    hasAdminAccess: adminServices.length > 0,
  };
}

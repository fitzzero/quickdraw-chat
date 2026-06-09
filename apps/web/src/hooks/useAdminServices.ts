"use client";

import * as React from "react";
import { useServiceQuery } from "@fitzzero/quickdraw-core/client";
import { useSocket } from "../providers";
import { useSubscription } from "./useSubscription";
import type { AdminServiceMeta } from "@project/shared";

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

const EMPTY_PAYLOAD: Record<string, never> = {};

/**
 * Hook to get the list of services the current user has admin access to.
 * Reads the user's serviceAccess from their subscription data.
 *
 * Metadata is fetched with the generic quickdraw-core `useServiceQuery` (admin
 * methods use dynamic `${serviceName}:adminMeta` event names that are not part
 * of the typed `ServiceMethodsMap`). Because hooks can't be called in a loop,
 * the services are queried one at a time: each settled query marks its service
 * as attempted, which advances `pendingService` to the next one.
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
  const { userId } = useSocket();
  const { data: user } = useSubscription("userService", userId ?? "");
  const [servicesMeta, setServicesMeta] = React.useState<Map<string, AdminServiceMeta>>(new Map());
  const [attempted, setAttempted] = React.useState<Set<string>>(new Set());

  // Get services where user has Admin access
  const adminServiceNames = React.useMemo(() => {
    if (!user?.serviceAccess) return [];

    return Object.entries(user.serviceAccess)
      .filter(([_, level]) => level === "Admin")
      .map(([serviceName]) => serviceName);
  }, [user?.serviceAccess]);

  // Next service whose metadata still needs to be fetched
  const pendingService = adminServiceNames.find((name) => !attempted.has(name));

  const markAttempted = React.useCallback((serviceName: string) => {
    setAttempted((prev) => {
      const next = new Set(prev);
      next.add(serviceName);
      return next;
    });
  }, []);

  useServiceQuery<Record<string, never>, AdminServiceMeta>(
    pendingService ?? "",
    "adminMeta",
    EMPTY_PAYLOAD,
    {
      enabled: !!pendingService,
      onSuccess: (meta) => {
        if (!pendingService) return;
        setServicesMeta((prev) => new Map(prev).set(pendingService, meta));
        markAttempted(pendingService);
      },
      onError: () => {
        if (pendingService) {
          markAttempted(pendingService);
        }
      },
    },
  );

  const isLoadingMeta = pendingService !== undefined;

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

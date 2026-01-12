"use client";

import * as React from "react";
import {
  Box,
  Typography,
  Switch,
  FormControlLabel,
  Button,
  Divider,
  CircularProgress,
  Alert,
} from "@mui/material";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import { useTranslations } from "next-intl";
import { useSocket } from "../../providers";
import { useAdminServices } from "../../hooks/useAdminServices";
import type { AccessLevel, ServiceResponse } from "@project/shared";

interface UserServiceAccessEditorProps {
  userId: string;
  currentAccess: Record<string, AccessLevel> | null;
  onAccessUpdated: (newAccess: Record<string, AccessLevel>) => void;
}

/**
 * Component for editing a user's service-level admin access.
 * Displays toggles for each service with Admin on/off.
 */
export function UserServiceAccessEditor({
  userId,
  currentAccess,
  onAccessUpdated,
}: UserServiceAccessEditorProps): React.ReactElement {
  const t = useTranslations("Admin");
  const { socket, isConnected } = useSocket();
  const { adminServices, isLoading: servicesLoading } = useAdminServices();

  const [localAccess, setLocalAccess] = React.useState<Record<string, AccessLevel>>(
    currentAccess ?? {}
  );
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [hasChanges, setHasChanges] = React.useState(false);

  // Sync local state when currentAccess changes
  React.useEffect(() => {
    setLocalAccess(currentAccess ?? {});
    setHasChanges(false);
  }, [currentAccess]);

  // Toggle admin access for a service
  const handleToggle = (serviceName: string, checked: boolean): void => {
    setLocalAccess((prev) => {
      if (checked) {
        return { ...prev, [serviceName]: "Admin" as AccessLevel };
      } else {
        // Remove the key by creating a new object without it
        const { [serviceName]: _, ...rest } = prev;
        return rest;
      }
    });
    setHasChanges(true);
  };

  // Grant admin to all services
  const handleGrantAll = (): void => {
    const newAccess: Record<string, AccessLevel> = {};
    for (const service of adminServices) {
      newAccess[service.serviceName] = "Admin";
    }
    setLocalAccess(newAccess);
    setHasChanges(true);
  };

  // Revoke admin from all services
  const handleRevokeAll = (): void => {
    setLocalAccess({});
    setHasChanges(true);
  };

  // Save changes
  const handleSave = React.useCallback((): void => {
    if (!socket || !isConnected) return;

    setIsSaving(true);
    setError(null);

    socket.emit(
      "userService:adminUpdate",
      { id: userId, data: { serviceAccess: localAccess } },
      (response: ServiceResponse<Record<string, unknown>>) => {
        if (response.success) {
          onAccessUpdated(localAccess);
          setHasChanges(false);
        } else {
          setError(response.error);
        }
        setIsSaving(false);
      }
    );
  }, [socket, isConnected, userId, localAccess, onAccessUpdated]);

  // Cancel changes
  const handleCancel = (): void => {
    setLocalAccess(currentAccess ?? {});
    setHasChanges(false);
    setError(null);
  };

  if (servicesLoading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  // Get all service names (not just ones user is admin of)
  // We need to show all services that exist for this editor
  const allServiceNames = adminServices.map((s) => s.serviceName);

  return (
    <Box>
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          mb: 2,
        }}
      >
        <AdminPanelSettingsIcon color="warning" />
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t("serviceAccess")}
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Service toggles */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {allServiceNames.map((serviceName) => {
          const isAdmin = localAccess[serviceName] === "Admin";
          const displayName =
            adminServices.find((s) => s.serviceName === serviceName)?.displayName ??
            serviceName.replace(/Service$/i, "");

          return (
            <FormControlLabel
              key={serviceName}
              control={
                <Switch
                  checked={isAdmin}
                  onChange={(e): void => {
                    handleToggle(serviceName, e.target.checked);
                  }}
                  size="small"
                />
              }
              label={
                <Typography variant="body2">
                  {t("adminAccessFor", { service: displayName })}
                </Typography>
              }
            />
          );
        })}
      </Box>

      <Divider sx={{ my: 2 }} />

      {/* Bulk actions */}
      <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
        <Button
          variant="outlined"
          size="small"
          onClick={handleGrantAll}
          disabled={isSaving}
        >
          {t("grantAllAdmin")}
        </Button>
        <Button
          variant="outlined"
          size="small"
          color="error"
          onClick={handleRevokeAll}
          disabled={isSaving}
        >
          {t("revokeAllAdmin")}
        </Button>
      </Box>

      {/* Save/Cancel */}
      {hasChanges && (
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            variant="contained"
            size="small"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? <CircularProgress size={16} /> : t("saveAccess")}
          </Button>
          <Button
            variant="outlined"
            size="small"
            onClick={handleCancel}
            disabled={isSaving}
          >
            {t("cancelChanges")}
          </Button>
        </Box>
      )}
    </Box>
  );
}

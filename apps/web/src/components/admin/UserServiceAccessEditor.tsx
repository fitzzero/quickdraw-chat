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
import { useAdminServices } from "@fitzzero/quickdraw-core/client";
import type { AccessLevel } from "@project/shared";
import { useErrorText } from "../../hooks/useErrorText";
import { qd } from "../../lib/quickdraw";

interface UserServiceAccessEditorProps {
  userId: string;
}

/**
 * Component for editing a user's service-level admin access.
 * Displays toggles for each service with Admin on/off.
 *
 * The grants come from the user's live row (an administrator reads it at
 * Admin) and are written by the admin kit's `adminUpdate`, which writes
 * `serviceAccess` for callers whose own userService grant is Admin (the
 * service passes `grants: true`). The live row shows the saved grants once
 * the write lands, and the user's open sockets get them from the server
 * (`qd:access`).
 */
export function UserServiceAccessEditor({
  userId,
}: UserServiceAccessEditorProps): React.ReactElement {
  const t = useTranslations("Admin");
  const errorText = useErrorText();
  const { services: adminServices, isLoading: servicesLoading } = useAdminServices(qd);
  const { data: user } = qd.userService.useEntity(userId);
  const setServiceAccess = qd.userService.admin.adminUpdate.useMutation();
  const isSaving = setServiceAccess.isPending;

  // The edited grants (a form draft); null while showing the saved ones
  const [draft, setDraft] = React.useState<Record<string, AccessLevel> | null>(null);
  const saved = React.useMemo(() => ({ ...user?.serviceAccess }), [user?.serviceAccess]);
  const localAccess = draft ?? saved;
  const hasChanges = draft !== null;

  // Toggle admin access for a service
  const handleToggle = (serviceName: string, checked: boolean): void => {
    const rest = Object.fromEntries(
      Object.entries(localAccess).filter(([name]) => name !== serviceName),
    );
    setDraft(checked ? { ...rest, [serviceName]: "Admin" } : rest);
  };

  // Grant admin to all services
  const handleGrantAll = (): void => {
    const newAccess: Record<string, AccessLevel> = {};
    for (const service of adminServices) {
      newAccess[service.serviceName] = "Admin";
    }
    setDraft(newAccess);
  };

  // Revoke admin from all services
  const handleRevokeAll = (): void => {
    setDraft({});
  };

  // Save changes
  const handleSave = (): void => {
    if (draft === null) return;
    setServiceAccess.mutate(
      { id: userId, data: { serviceAccess: draft } },
      {
        onSuccess: () => {
          setDraft(null);
        },
      },
    );
  };

  // Cancel changes
  const handleCancel = (): void => {
    setDraft(null);
    setServiceAccess.reset();
  };

  if (servicesLoading || user === undefined) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

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

      {setServiceAccess.error !== null && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {errorText(setServiceAccess.error)}
        </Alert>
      )}

      {/* Service toggles: the services whose admin screens this administrator has */}
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {adminServices.map((service) => (
          <FormControlLabel
            key={service.key}
            control={
              <Switch
                checked={localAccess[service.serviceName] === "Admin"}
                onChange={(e): void => {
                  handleToggle(service.serviceName, e.target.checked);
                }}
                size="small"
              />
            }
            label={
              <Typography variant="body2">
                {t("adminAccessFor", { service: service.displayName })}
              </Typography>
            }
          />
        ))}
      </Box>

      <Divider sx={{ my: 2 }} />

      {/* Bulk actions */}
      <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
        <Button variant="outlined" size="small" onClick={handleGrantAll} disabled={isSaving}>
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
          <Button variant="contained" size="small" onClick={handleSave} disabled={isSaving}>
            {isSaving ? <CircularProgress size={16} /> : t("saveAccess")}
          </Button>
          <Button variant="outlined" size="small" onClick={handleCancel} disabled={isSaving}>
            {t("cancelChanges")}
          </Button>
        </Box>
      )}
    </Box>
  );
}

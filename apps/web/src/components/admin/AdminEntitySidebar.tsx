"use client";

import * as React from "react";
import {
  Box,
  Typography,
  IconButton,
  Button,
  Divider,
  CircularProgress,
  Alert,
  TextField,
  Switch,
  FormControlLabel,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import SaveIcon from "@mui/icons-material/Save";
import CancelIcon from "@mui/icons-material/Cancel";
import { useTranslations } from "next-intl";
import { useService, useServiceQuery } from "@fitzzero/quickdraw-core/client";
import { ConfirmDialog } from "../feedback";
import { UserServiceAccessEditor } from "./UserServiceAccessEditor";
import type { AdminServiceMeta, AdminFieldConfig, AccessLevel } from "@project/shared";

/** Safely convert unknown to string for display - avoids no-base-to-string for objects */
function toDisplayString(val: unknown, pretty = false): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "object") return pretty ? JSON.stringify(val, null, 2) : JSON.stringify(val);
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "symbol") return val.toString();
  if (typeof val === "bigint") return String(val);
  return "";
}

interface AdminEntitySidebarProps {
  serviceName: string;
  entryId: string;
  meta: AdminServiceMeta;
  onClose: () => void;
  onDeleted: () => void;
}

/**
 * Sidebar for viewing and editing a selected entity.
 */
export function AdminEntitySidebar({
  serviceName,
  entryId,
  meta,
  onClose,
  onDeleted,
}: AdminEntitySidebarProps): React.ReactElement {
  const t = useTranslations("Common");
  const tAdmin = useTranslations("Admin");

  const [entity, setEntity] = React.useState<Record<string, unknown> | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const [editedValues, setEditedValues] = React.useState<Record<string, unknown>>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);

  // Fetch entity data. The admin protocol uses dynamic event names not present
  // in ServiceMethodsMap, so the generic quickdraw-core hooks are used here.
  const getPayload = React.useMemo(() => ({ id: entryId }), [entryId]);
  const { data: fetchedEntity, error: fetchError } = useServiceQuery<
    { id: string },
    Record<string, unknown>
  >(serviceName, "adminGet", getPayload, {
    enabled: !!entryId,
    // Always show fresh data when opening the sidebar
    staleTime: 0,
  });
  const isLoading = fetchedEntity === undefined && !fetchError;

  // Sync fetched entity into local state (edits/saves update it locally)
  React.useEffect(() => {
    if (fetchedEntity) {
      setEntity(fetchedEntity);
      setEditedValues(fetchedEntity);
      setError(null);
    }
  }, [fetchedEntity]);

  React.useEffect(() => {
    if (fetchError) {
      setEntity(null);
      setError(fetchError);
    }
  }, [fetchError]);

  // Mutations for the dynamic admin protocol
  const adminUpdate = useService<
    { id: string; data: Record<string, unknown> },
    Record<string, unknown>
  >(serviceName, "adminUpdate");
  const adminDelete = useService<{ id: string }, { success: boolean }>(serviceName, "adminDelete");
  const isSaving = adminUpdate.isPending;
  const isDeleting = adminDelete.isPending;

  // Handle save
  const handleSave = React.useCallback(async (): Promise<void> => {
    if (!entity) return;

    // Build update payload with only changed editable fields
    const updateData: Record<string, unknown> = {};
    for (const field of meta.fields) {
      if (field.editable && editedValues[field.name] !== entity[field.name]) {
        updateData[field.name] = editedValues[field.name];
      }
    }

    try {
      const updated = await adminUpdate.mutateAsync({ id: entryId, data: updateData });
      setEntity(updated);
      setEditedValues(updated ?? {});
      setIsEditing(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [adminUpdate, entryId, entity, editedValues, meta.fields]);

  // Handle delete
  const handleDelete = React.useCallback(async (): Promise<void> => {
    try {
      await adminDelete.mutateAsync({ id: entryId });
      setDeleteDialogOpen(false);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [adminDelete, entryId, onDeleted]);

  // Cancel editing
  const handleCancelEdit = () => {
    setEditedValues(entity ?? {});
    setIsEditing(false);
  };

  // Update a field value
  const handleFieldChange = (fieldName: string, value: unknown) => {
    setEditedValues((prev) => ({ ...prev, [fieldName]: value }));
  };

  // Render field value in view mode
  const renderViewValue = (field: AdminFieldConfig, value: unknown): React.ReactNode => {
    if (value === null || value === undefined) {
      return <Typography color="text.secondary">{t("notSet")}</Typography>;
    }

    switch (field.type) {
      case "boolean":
        return value ? t("yes") : t("no");
      case "date":
        try {
          return new Date(value as string).toLocaleString();
        } catch {
          return toDisplayString(value);
        }
      case "json":
        return (
          <Typography
            variant="body2"
            component="pre"
            sx={{
              bgcolor: "action.hover",
              p: 1,
              borderRadius: 1,
              overflow: "auto",
              maxHeight: 200,
              fontSize: "0.75rem",
            }}
          >
            {toDisplayString(value, true)}
          </Typography>
        );
      case "enum":
        return toDisplayString(value);
      default:
        return toDisplayString(value);
    }
  };

  // Render field input in edit mode
  const renderEditInput = (field: AdminFieldConfig, value: unknown): React.ReactNode => {
    switch (field.type) {
      case "boolean":
        return (
          <FormControlLabel
            control={
              <Switch
                checked={Boolean(value)}
                onChange={(e): void => {
                  handleFieldChange(field.name, e.target.checked);
                }}
              />
            }
            label={field.label}
          />
        );

      case "enum":
        return (
          <FormControl fullWidth size="small">
            <InputLabel>{field.label}</InputLabel>
            <Select
              value={value ?? ""}
              label={field.label}
              onChange={(e): void => {
                handleFieldChange(field.name, e.target.value);
              }}
            >
              {field.enumValues?.map((enumVal) => (
                <MenuItem key={enumVal} value={enumVal}>
                  {enumVal}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        );

      case "number":
        return (
          <TextField
            fullWidth
            size="small"
            type="number"
            label={field.label}
            value={value ?? ""}
            onChange={(e): void => {
              handleFieldChange(field.name, Number(e.target.value));
            }}
          />
        );

      case "json":
        return (
          <TextField
            fullWidth
            size="small"
            multiline
            rows={4}
            label={field.label}
            value={typeof value === "string" ? value : JSON.stringify(value, null, 2)}
            onChange={(e): void => {
              try {
                handleFieldChange(field.name, JSON.parse(e.target.value));
              } catch {
                // Keep as string if not valid JSON
                handleFieldChange(field.name, e.target.value);
              }
            }}
          />
        );

      default:
        return (
          <TextField
            fullWidth
            size="small"
            label={field.label}
            value={value ?? ""}
            onChange={(e): void => {
              handleFieldChange(field.name, e.target.value);
            }}
          />
        );
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <Box sx={{ p: 3, display: "flex", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  // Error state
  if (error ?? !entity) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">{error ?? "Entity not found"}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <Box
        sx={{
          p: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {tAdmin("entityDetails")}
        </Typography>
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
        {/* ID (always shown, never editable) */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="caption" color="text.secondary">
            {tAdmin("idLabel")}
          </Typography>
          <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
            {entryId}
          </Typography>
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Fields */}
        {meta.fields
          .filter((f) => f.name !== "id" && f.name !== "serviceAccess")
          .map((field) => (
            <Box key={field.name} sx={{ mb: 2 }}>
              {isEditing && field.editable ? (
                renderEditInput(field, editedValues[field.name])
              ) : (
                <>
                  <Typography variant="caption" color="text.secondary">
                    {field.label}
                  </Typography>
                  <Box>{renderViewValue(field, entity[field.name])}</Box>
                </>
              )}
            </Box>
          ))}

        {/* User Service Access Editor - only for userService */}
        {serviceName === "userService" && (
          <>
            <Divider sx={{ my: 2 }} />
            <UserServiceAccessEditor
              userId={entryId}
              currentAccess={entity.serviceAccess as Record<string, AccessLevel> | null}
              onAccessUpdated={(newAccess): void => {
                setEntity((prev) => (prev ? { ...prev, serviceAccess: newAccess } : null));
              }}
            />
          </>
        )}
      </Box>

      {/* Actions */}
      <Box
        sx={{
          p: 2,
          borderTop: 1,
          borderColor: "divider",
          display: "flex",
          gap: 1,
        }}
      >
        {isEditing ? (
          <>
            <Button
              variant="contained"
              startIcon={isSaving ? <CircularProgress size={16} /> : <SaveIcon />}
              onClick={(): void => {
                void handleSave();
              }}
              disabled={isSaving}
              sx={{ flex: 1 }}
            >
              {t("save")}
            </Button>
            <Button
              variant="outlined"
              startIcon={<CancelIcon />}
              onClick={handleCancelEdit}
              disabled={isSaving}
            >
              {t("cancel")}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="outlined"
              startIcon={<EditIcon />}
              onClick={(): void => {
                setIsEditing(true);
              }}
              sx={{ flex: 1 }}
            >
              {t("edit")}
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={(): void => {
                setDeleteDialogOpen(true);
              }}
            >
              {t("delete")}
            </Button>
          </>
        )}
      </Box>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onClose={(): void => {
          setDeleteDialogOpen(false);
        }}
        onConfirm={handleDelete}
        title={tAdmin("deleteConfirmTitle")}
        message={tAdmin("deleteConfirmMessage")}
        confirmLabel={t("delete")}
        destructive
        isLoading={isDeleting}
      />
    </Box>
  );
}

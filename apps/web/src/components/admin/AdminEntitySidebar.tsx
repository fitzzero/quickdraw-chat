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
import { useSocket } from "../../providers";
import { ConfirmDialog } from "../feedback";
import { UserServiceAccessEditor } from "./UserServiceAccessEditor";
import type { AdminServiceMeta, AdminFieldConfig, ServiceResponse, AccessLevel } from "@project/shared";

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
  const { socket, isConnected } = useSocket();

  const [entity, setEntity] = React.useState<Record<string, unknown> | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const [editedValues, setEditedValues] = React.useState<Record<string, unknown>>({});
  const [isSaving, setIsSaving] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);

  // Fetch entity data
  React.useEffect(() => {
    if (!socket || !isConnected || !entryId) {
      return;
    }

    setIsLoading(true);
    setError(null);

    socket.emit(
      `${serviceName}:adminGet`,
      { id: entryId },
      (response: ServiceResponse<Record<string, unknown>>) => {
        if (response.success) {
          setEntity(response.data);
          setEditedValues(response.data ?? {});
          setError(null);
        } else {
          setEntity(null);
          setError(response.error);
        }
        setIsLoading(false);
      }
    );
  }, [socket, isConnected, serviceName, entryId]);

  // Handle save
  const handleSave = React.useCallback(() => {
    if (!socket || !entity) return;

    setIsSaving(true);

    // Build update payload with only changed editable fields
    const updateData: Record<string, unknown> = {};
    for (const field of meta.fields) {
      if (field.editable && editedValues[field.name] !== entity[field.name]) {
        updateData[field.name] = editedValues[field.name];
      }
    }

    socket.emit(
      `${serviceName}:adminUpdate`,
      { id: entryId, data: updateData },
      (response: ServiceResponse<Record<string, unknown>>) => {
        if (response.success) {
          setEntity(response.data);
          setEditedValues(response.data ?? {});
          setIsEditing(false);
          setError(null);
        } else {
          setError(response.error);
        }
        setIsSaving(false);
      }
    );
  }, [socket, serviceName, entryId, entity, editedValues, meta.fields]);

  // Handle delete
  const handleDelete = React.useCallback(() => {
    if (!socket) return;

    setIsDeleting(true);

    socket.emit(
      `${serviceName}:adminDelete`,
      { id: entryId },
      (response: ServiceResponse<{ success: boolean }>) => {
        if (response.success) {
          setDeleteDialogOpen(false);
          onDeleted();
        } else {
          setError(response.error);
        }
        setIsDeleting(false);
      }
    );
  }, [socket, serviceName, entryId, onDeleted]);

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
          return String(value);
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
            {JSON.stringify(value, null, 2)}
          </Typography>
        );
      case "enum":
        return String(value);
      default:
        return String(value);
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
            ID
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
              onClick={handleSave}
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

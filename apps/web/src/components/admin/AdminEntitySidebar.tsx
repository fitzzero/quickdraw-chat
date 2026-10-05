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
import type { AdminRow, AdminScreen } from "@fitzzero/quickdraw-core/client";
import { ConfirmDialog } from "../feedback";
import { UserServiceAccessEditor } from "./UserServiceAccessEditor";
import { useErrorText } from "../../hooks/useErrorText";
import { qd } from "../../lib/quickdraw";
import type { AdminServiceMeta, AdminFieldConfig } from "@project/shared";

/** Whether the generic form shows a field: not one an override kept out (the user's grants). */
function inForm(field: AdminFieldConfig): boolean {
  return field.showInForm !== false;
}

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

/** One field's value, read-only. */
function FieldView({
  field,
  value,
}: {
  field: AdminFieldConfig;
  value: unknown;
}): React.ReactElement {
  const t = useTranslations("Common");
  if (value === null || value === undefined) {
    return <Typography color="text.secondary">{t("notSet")}</Typography>;
  }
  switch (field.type) {
    case "boolean":
      return <Typography variant="body2">{value ? t("yes") : t("no")}</Typography>;
    case "date":
      return (
        <Typography variant="body2">
          {typeof value === "string" ? new Date(value).toLocaleString() : toDisplayString(value)}
        </Typography>
      );
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
    default:
      return <Typography variant="body2">{toDisplayString(value)}</Typography>;
  }
}

/** One field's input, while editing. */
function FieldInput({
  field,
  value,
  onChange,
}: {
  field: AdminFieldConfig;
  value: unknown;
  onChange: (value: unknown) => void;
}): React.ReactElement {
  switch (field.type) {
    case "boolean":
      return (
        <FormControlLabel
          control={
            <Switch
              checked={Boolean(value)}
              onChange={(e): void => {
                onChange(e.target.checked);
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
            value={toDisplayString(value)}
            label={field.label}
            onChange={(e): void => {
              onChange(e.target.value);
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
          value={toDisplayString(value)}
          onChange={(e): void => {
            onChange(Number(e.target.value));
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
              onChange(JSON.parse(e.target.value));
            } catch {
              // Keep as string if not valid JSON
              onChange(e.target.value);
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
          value={toDisplayString(value)}
          onChange={(e): void => {
            onChange(e.target.value);
          }}
        />
      );
  }
}

interface EditActionsProps {
  adminUpdate: NonNullable<AdminScreen["adminUpdate"]>;
  entity: AdminRow;
  meta: AdminServiceMeta;
  /** The values being edited; null while viewing. */
  editedValues: Record<string, unknown> | null;
  onEdit: () => void;
  onDone: () => void;
  onSaved: () => void;
}

/** Edit, then save the changed fields with adminUpdate (services whose kit exposes it). */
function EditActions({
  adminUpdate,
  entity,
  meta,
  editedValues,
  onEdit,
  onDone,
  onSaved,
}: EditActionsProps): React.ReactElement {
  const t = useTranslations("Common");
  const errorText = useErrorText();
  const update = adminUpdate.useMutation();

  const handleSave = (): void => {
    if (editedValues === null) return;
    // Only the editable fields that changed
    const data: Record<string, unknown> = {};
    for (const field of meta.fields) {
      if (field.editable && editedValues[field.name] !== entity[field.name]) {
        data[field.name] = editedValues[field.name];
      }
    }
    update.mutate({ id: entity.id, data }, { onSuccess: onSaved });
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {update.error !== null && <Alert severity="error">{errorText(update.error)}</Alert>}
      <Box sx={{ display: "flex", gap: 1 }}>
        {editedValues === null ? (
          <Button variant="outlined" startIcon={<EditIcon />} onClick={onEdit} sx={{ flex: 1 }}>
            {t("edit")}
          </Button>
        ) : (
          <>
            <Button
              variant="contained"
              startIcon={update.isPending ? <CircularProgress size={16} /> : <SaveIcon />}
              onClick={handleSave}
              disabled={update.isPending}
              sx={{ flex: 1 }}
            >
              {t("save")}
            </Button>
            <Button
              variant="outlined"
              startIcon={<CancelIcon />}
              onClick={(): void => {
                update.reset();
                onDone();
              }}
              disabled={update.isPending}
            >
              {t("cancel")}
            </Button>
          </>
        )}
      </Box>
    </Box>
  );
}

/** Delete the row with adminDelete, after a confirmation. */
function DeleteAction({
  adminDelete,
  id,
  onDeleted,
}: {
  adminDelete: NonNullable<AdminScreen["adminDelete"]>;
  id: string;
  onDeleted: () => void;
}): React.ReactElement {
  const t = useTranslations("Common");
  const tAdmin = useTranslations("Admin");
  const errorText = useErrorText();
  const remove = adminDelete.useMutation();
  const [open, setOpen] = React.useState(false);

  return (
    <>
      {remove.error !== null && <Alert severity="error">{errorText(remove.error)}</Alert>}
      <Button
        variant="outlined"
        color="error"
        startIcon={<DeleteIcon />}
        onClick={(): void => {
          setOpen(true);
        }}
      >
        {t("delete")}
      </Button>
      <ConfirmDialog
        open={open}
        onClose={(): void => {
          setOpen(false);
        }}
        onConfirm={(): void => {
          remove.mutate(
            { id },
            {
              onSuccess: onDeleted,
              onSettled: () => {
                setOpen(false);
              },
            },
          );
        }}
        title={tAdmin("deleteConfirmTitle")}
        message={tAdmin("deleteConfirmMessage")}
        confirmLabel={t("delete")}
        destructive
        isLoading={remove.isPending}
      />
    </>
  );
}

interface AdminEntitySidebarProps {
  /** The service's admin kit members (`adminOf(qd, key)`). */
  admin: AdminScreen;
  /** Its `adminGet`, which the sidebar reads the row with. */
  adminGet: NonNullable<AdminScreen["adminGet"]>;
  entryId: string;
  meta: AdminServiceMeta;
  onClose: () => void;
  /** The row was changed: the list reads its page again. */
  onChanged: () => void;
  onDeleted: () => void;
}

/**
 * Sidebar for viewing and editing a selected entity, through the service's
 * admin kit: adminGet reads it as a service administrator sees it,
 * adminUpdate writes the changed fields, adminDelete removes it.
 */
export function AdminEntitySidebar({
  admin,
  adminGet,
  entryId,
  meta,
  onClose,
  onChanged,
  onDeleted,
}: AdminEntitySidebarProps): React.ReactElement {
  const tAdmin = useTranslations("Admin");
  const errorText = useErrorText();

  const { data: entity, error, isLoading } = adminGet.useQuery({ id: entryId });
  // The values being edited (a form draft); null while viewing
  const [editedValues, setEditedValues] = React.useState<Record<string, unknown> | null>(null);

  const handleSaved = React.useCallback((): void => {
    setEditedValues(null);
    // The kit's rows are not live: read this row and the list again
    qd.invalidate(adminGet, { id: entryId });
    onChanged();
  }, [adminGet, entryId, onChanged]);

  if (isLoading) {
    return (
      <Box sx={{ p: 3, display: "flex", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error !== null || entity === undefined) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">{error === null ? tAdmin("noEntries") : errorText(error)}</Alert>
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

        {/* Fields (the kit leaves out hidden ones, such as acl); a user's
            grants are kept out of the form and have their own editor below */}
        {meta.fields
          .filter((f) => f.name !== "id" && inForm(f))
          .map((field) => (
            <Box key={field.name} sx={{ mb: 2 }}>
              {editedValues !== null && field.editable ? (
                <FieldInput
                  field={field}
                  value={editedValues[field.name]}
                  onChange={(value): void => {
                    setEditedValues((prev) => (prev ? { ...prev, [field.name]: value } : prev));
                  }}
                />
              ) : (
                <>
                  <Typography variant="caption" color="text.secondary">
                    {field.label}
                  </Typography>
                  <Box>
                    <FieldView field={field} value={entity[field.name]} />
                  </Box>
                </>
              )}
            </Box>
          ))}

        {/* A user's service-wide grants: the field the kit marks `kind: "grants"` */}
        {meta.fields.some((f) => f.kind === "grants") && (
          <>
            <Divider sx={{ my: 2 }} />
            <UserServiceAccessEditor userId={entryId} />
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
          flexDirection: "column",
          gap: 1,
        }}
      >
        {admin.adminUpdate !== undefined && (
          <EditActions
            adminUpdate={admin.adminUpdate}
            entity={entity}
            meta={meta}
            editedValues={editedValues}
            onEdit={(): void => {
              setEditedValues({ ...entity });
            }}
            onDone={(): void => {
              setEditedValues(null);
            }}
            onSaved={handleSaved}
          />
        )}
        {admin.adminDelete !== undefined && (
          <DeleteAction adminDelete={admin.adminDelete} id={entryId} onDeleted={onDeleted} />
        )}
      </Box>
    </Box>
  );
}

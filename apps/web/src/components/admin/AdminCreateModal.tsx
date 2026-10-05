"use client";

import * as React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  CircularProgress,
  Alert,
  Switch,
  FormControlLabel,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Box,
} from "@mui/material";
import { useTranslations } from "next-intl";
import type { AdminScreen } from "@fitzzero/quickdraw-core/client";
import type { AdminServiceMeta, AdminFieldConfig } from "@project/shared";
import { useErrorText } from "../../hooks/useErrorText";

interface AdminCreateModalProps {
  open: boolean;
  onClose: () => void;
  /** The service's adminCreate (the admin kit's member, from `adminOf(qd, key)`). */
  adminCreate: NonNullable<AdminScreen["adminCreate"]>;
  meta: AdminServiceMeta;
  onSuccess: () => void;
}

/**
 * Get default value for a field based on its type.
 */
function getDefaultValue(field: AdminFieldConfig): unknown {
  switch (field.type) {
    case "boolean":
      return false;
    case "number":
      return 0;
    case "enum":
      return field.enumValues?.[0] ?? "";
    case "json":
      return {};
    default:
      return "";
  }
}

/**
 * Modal for creating a new entity.
 * Dynamically renders form fields based on the service metadata.
 */
export function AdminCreateModal({
  open,
  onClose,
  adminCreate,
  meta,
  onSuccess,
}: AdminCreateModalProps): React.ReactElement {
  const t = useTranslations("Common");
  const tAdmin = useTranslations("Admin");
  const errorText = useErrorText();

  // The fields the form writes: the editable ones, but those an override
  // keeps out of a generic form (a user's grants, which have their own editor)
  const formFields = React.useMemo(
    () => meta.fields.filter((f) => f.editable && f.showInForm !== false && f.name !== "id"),
    [meta.fields],
  );

  // Initialize form values with defaults
  const [values, setValues] = React.useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    formFields.forEach((field) => {
      initial[field.name] = getDefaultValue(field);
    });
    return initial;
  });

  const create = adminCreate.useMutation();
  const isSubmitting = create.isPending;
  const { reset } = create;

  // Reset form when modal opens
  React.useEffect(() => {
    if (open) {
      const initial: Record<string, unknown> = {};
      formFields.forEach((field) => {
        initial[field.name] = getDefaultValue(field);
      });
      setValues(initial);
      reset();
    }
  }, [open, formFields, reset]);

  // Update a field value
  const handleFieldChange = (fieldName: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [fieldName]: value }));
  };

  // Submit form
  const handleSubmit = (): void => {
    // Filter out empty values for optional fields
    const createData: Record<string, unknown> = {};
    formFields.forEach((field) => {
      const value = values[field.name];
      // Include required fields always, optional fields only if not empty
      if (field.required || (value !== "" && value !== null && value !== undefined)) {
        createData[field.name] = value;
      }
    });

    create.mutate({ data: createData }, { onSuccess });
  };

  // Render field input
  const renderInput = (field: AdminFieldConfig): React.ReactNode => {
    const value = values[field.name];

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
          <FormControl fullWidth size="small" required={field.required}>
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
            required={field.required}
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
            rows={3}
            label={field.label}
            required={field.required}
            value={typeof value === "string" ? value : JSON.stringify(value, null, 2)}
            onChange={(e): void => {
              try {
                handleFieldChange(field.name, JSON.parse(e.target.value));
              } catch {
                handleFieldChange(field.name, e.target.value);
              }
            }}
            helperText="Enter valid JSON"
          />
        );

      default:
        return (
          <TextField
            fullWidth
            size="small"
            label={field.label}
            required={field.required}
            value={value ?? ""}
            onChange={(e): void => {
              handleFieldChange(field.name, e.target.value);
            }}
          />
        );
    }
  };

  // The inputs shown: the form's fields but the timestamps
  const editableFields = formFields.filter((f) => f.name !== "createdAt" && f.name !== "updatedAt");

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{tAdmin("createTitle")}</DialogTitle>
      <DialogContent>
        {create.error !== null && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {errorText(create.error)}
          </Alert>
        )}

        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          {editableFields.map((field) => (
            <Box key={field.name}>{renderInput(field)}</Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSubmitting}>
          {t("cancel")}
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={isSubmitting}>
          {isSubmitting ? <CircularProgress size={20} /> : t("create")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

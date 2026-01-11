"use client";

import * as React from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  CircularProgress,
} from "@mui/material";
import { useTranslations } from "next-intl";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** If true, the confirm button will be red (for destructive actions) */
  destructive?: boolean;
  /** If true, shows a loading spinner and disables buttons */
  isLoading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  isLoading = false,
}: ConfirmDialogProps): React.ReactElement {
  const tCommon = useTranslations("Common");

  const handleConfirm = (): void => {
    void onConfirm();
  };

  return (
    <Dialog
      open={open}
      onClose={isLoading ? undefined : onClose}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isLoading}>
          {cancelLabel ?? tCommon("cancel")}
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          color={destructive ? "error" : "primary"}
          disabled={isLoading}
        >
          {isLoading ? (
            <CircularProgress size={20} color="inherit" />
          ) : (
            confirmLabel ?? tCommon("confirm")
          )}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

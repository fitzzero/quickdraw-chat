"use client";

import * as React from "react";
import { Snackbar, Alert, type AlertColor } from "@mui/material";

interface Toast {
  id: number;
  message: string;
  severity: AlertColor;
  duration: number;
}

interface ToastContextValue {
  showToast: (message: string, severity?: AlertColor, options?: { duration?: number }) => void;
}

const ToastContext = React.createContext<ToastContextValue | undefined>(undefined);

interface ToastProviderProps {
  children: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps): React.ReactElement {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const [currentToast, setCurrentToast] = React.useState<Toast | null>(null);
  const toastIdRef = React.useRef(0);

  const showToast = React.useCallback(
    (message: string, severity: AlertColor = "success", options?: { duration?: number }) => {
      const id = toastIdRef.current++;
      const defaultDuration = severity === "error" ? 6000 : 4000;
      const duration = options?.duration ?? defaultDuration;

      const newToast: Toast = {
        id,
        message,
        severity,
        duration,
      };

      setToasts((prev) => [...prev, newToast]);
    },
    [],
  );

  // Process toast queue
  React.useEffect(() => {
    if (toasts.length > 0 && !currentToast) {
      setCurrentToast(toasts[0]);
      setToasts((prev) => prev.slice(1));
    }
  }, [toasts, currentToast]);

  const handleClose = React.useCallback(
    (_event?: React.SyntheticEvent | Event, reason?: string) => {
      // Don't close on clickaway
      if (reason === "clickaway") {
        return;
      }
      setCurrentToast(null);
    },
    [],
  );

  const contextValue = React.useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <Snackbar
        open={!!currentToast}
        autoHideDuration={currentToast?.duration ?? 4000}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {currentToast ? (
          <Alert
            onClose={handleClose}
            severity={currentToast.severity}
            variant="filled"
            sx={{ width: "100%" }}
          >
            {currentToast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

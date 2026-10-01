"use client";

import * as React from "react";
import { Box, Typography, Button, Alert } from "@mui/material";
import { useTranslations } from "next-intl";

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface ErrorFallbackProps {
  error: Error | null;
  onReset: () => void;
}

/**
 * Default fallback UI rendered when the boundary catches an error.
 * Implemented as a function component so we can use the next-intl hook
 * (hooks are unavailable in the class-based ErrorBoundary itself).
 */
function ErrorBoundaryFallback({ error, onReset }: ErrorFallbackProps): React.ReactElement {
  const t = useTranslations("ErrorBoundary");

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 3,
      }}
    >
      <Box sx={{ maxWidth: 600, width: "100%" }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          <Typography variant="h6" gutterBottom>
            {t("title")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {process.env.NODE_ENV === "development" ? error?.message : t("unexpectedError")}
          </Typography>
          {process.env.NODE_ENV === "development" && error?.stack && (
            <Box
              component="pre"
              sx={{
                mt: 2,
                p: 2,
                bgcolor: "background.paper",
                borderRadius: 1,
                overflow: "auto",
                fontSize: "0.75rem",
                maxHeight: 200,
              }}
            >
              {error.stack}
            </Box>
          )}
        </Alert>
        <Box sx={{ display: "flex", gap: 2 }}>
          <Button variant="contained" onClick={onReset}>
            {t("tryAgain")}
          </Button>
          <Button
            variant="outlined"
            onClick={() => {
              window.location.reload();
            }}
          >
            {t("reloadPage")}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary component that catches React errors and displays a fallback UI.
 *
 * Integration points for error logging:
 * - Add Sentry.captureException(error) in componentDidCatch
 * - Add LogRocket.captureException(error) in componentDidCatch
 * - Add custom analytics tracking
 *
 * @example
 * ```tsx
 * <ErrorBoundary>
 *   <YourComponent />
 * </ErrorBoundary>
 * ```
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log error to console in development
    if (process.env.NODE_ENV === "development") {
      // oxlint-disable-next-line no-console -- Intentional error logging in development
      console.error("Error caught by boundary:", error, errorInfo);
    }

    // Report to an error service here (Sentry, LogRocket, your own
    // endpoint). Each provider's Next.js guide covers the wiring.
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      return <ErrorBoundaryFallback error={this.state.error} onReset={this.handleReset} />;
    }

    return this.props.children;
  }
}

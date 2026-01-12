"use client";

import * as React from "react";
import { Box, Typography, Button, Alert } from "@mui/material";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
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
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
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
      // eslint-disable-next-line no-console -- Intentional error logging in development
      console.error("Error caught by boundary:", error, errorInfo);
    }

    // TODO: Add error logging service integration
    // Example integrations:
    //
    // Sentry:
    // import * as Sentry from "@sentry/nextjs";
    // Sentry.captureException(error, {
    //   contexts: { react: { componentStack: errorInfo.componentStack } },
    // });
    //
    // LogRocket:
    // import LogRocket from "logrocket";
    // LogRocket.captureException(error, {
    //   extra: { componentStack: errorInfo.componentStack },
    // });
    //
    // Custom logging:
    // fetch("/api/log-error", {
    //   method: "POST",
    //   body: JSON.stringify({
    //     error: error.message,
    //     stack: error.stack,
    //     componentStack: errorInfo.componentStack,
    //   }),
    // });
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
                Something went wrong
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {process.env.NODE_ENV === "development"
                  ? this.state.error?.message
                  : "An unexpected error occurred. Please try refreshing the page."}
              </Typography>
              {process.env.NODE_ENV === "development" && this.state.error?.stack && (
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
                  {this.state.error.stack}
                </Box>
              )}
            </Alert>
            <Box sx={{ display: "flex", gap: 2 }}>
              <Button variant="contained" onClick={this.handleReset}>
                Try Again
              </Button>
              <Button
                variant="outlined"
                onClick={() => {
                  window.location.reload();
                }}
              >
                Reload Page
              </Button>
            </Box>
          </Box>
        </Box>
      );
    }

    return this.props.children;
  }
}

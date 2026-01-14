"use client";

import * as React from "react";
import { Box, CircularProgress } from "@mui/material";
import { ThemeProvider } from "./ThemeProvider";
import { LayoutProvider } from "./LayoutProvider";
import { IntlProvider } from "./IntlProvider";
import { QuickdrawProvider, useQuickdrawSocket } from "@fitzzero/quickdraw-core/client";
import { getAuthToken } from "../lib/auth";
import { ClientShell } from "../components/layout";

interface ProvidersProps {
  children: React.ReactNode;
}

const SERVER_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function Providers({ children }: ProvidersProps): React.ReactElement {
  const [authToken, setAuthTokenState] = React.useState<string | undefined>(undefined);
  const [isReady, setIsReady] = React.useState(false);

  // Load auth token on client side and listen for changes
  React.useEffect(() => {
    // Initial load
    const token = getAuthToken();
    setAuthTokenState(token ?? undefined);
    setIsReady(true);

    // Listen for storage events (cross-tab changes)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "auth_token") {
        setAuthTokenState(e.newValue ?? undefined);
      }
    };

    // Listen for custom event (same-tab changes from auth callback)
    const handleAuthChange = () => {
      const newToken = getAuthToken();
      setAuthTokenState(newToken ?? undefined);
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("auth-token-changed", handleAuthChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("auth-token-changed", handleAuthChange);
    };
  }, []);

  // Show loading state until we've checked for auth token
  // This prevents useSocket from being called before QuickdrawProvider is mounted
  if (!isReady) {
    return (
      <ThemeProvider>
        <Box
          sx={{
            height: "100vh",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <CircularProgress />
        </Box>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <IntlProvider>
        <QuickdrawProvider serverUrl={SERVER_URL} authToken={authToken}>
          <LayoutProvider>
            <ClientShell>{children}</ClientShell>
          </LayoutProvider>
        </QuickdrawProvider>
      </IntlProvider>
    </ThemeProvider>
  );
}

// Re-export useQuickdrawSocket as useSocket for backward compatibility
export { useQuickdrawSocket as useSocket };

// Re-export layout hooks
export { useLayout, useRightSidebar, usePageTitle } from "./LayoutProvider";

// Re-export i18n hooks
export { useLocale } from "./IntlProvider";

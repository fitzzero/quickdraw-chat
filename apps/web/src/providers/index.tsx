"use client";

import * as React from "react";
import { Box, CircularProgress } from "@mui/material";
import { ThemeProvider } from "./ThemeProvider";
import { QuickdrawProvider, useQuickdrawSocket } from "@fitzzero/quickdraw-core/client";
import { getAuthToken } from "../lib/auth";

interface ProvidersProps {
  children: React.ReactNode;
}

const SERVER_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export function Providers({ children }: ProvidersProps): React.ReactElement {
  const [authToken, setAuthToken] = React.useState<string | undefined>(undefined);
  const [isReady, setIsReady] = React.useState(false);

  // Load auth token on client side
  React.useEffect(() => {
    const token = getAuthToken();
    setAuthToken(token ?? undefined);
    setIsReady(true);
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
      <QuickdrawProvider serverUrl={SERVER_URL} authToken={authToken} autoConnect>
        {children}
      </QuickdrawProvider>
    </ThemeProvider>
  );
}

// Re-export useQuickdrawSocket as useSocket for backward compatibility
export { useQuickdrawSocket as useSocket };

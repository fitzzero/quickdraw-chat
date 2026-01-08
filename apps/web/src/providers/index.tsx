"use client";

import * as React from "react";
import { ThemeProvider } from "./ThemeProvider";
import { QueryProvider } from "./QueryProvider";
import { SocketProvider } from "./SocketProvider";
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

  // Don't render socket provider until we've checked for auth token
  if (!isReady) {
    return (
      <ThemeProvider>
        <QueryProvider>{children}</QueryProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <QueryProvider>
        <SocketProvider serverUrl={SERVER_URL} authToken={authToken} autoConnect>
          {children}
        </SocketProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}

export { useSocket } from "./SocketProvider";

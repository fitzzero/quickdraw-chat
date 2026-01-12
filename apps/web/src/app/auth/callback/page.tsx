"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Box, CircularProgress, Typography, Alert } from "@mui/material";
import { setAuthToken, parseJWTPayload } from "../../../lib/auth";

export default function AuthCallbackPage(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const token = searchParams.get("token");

    if (!token) {
      setError("No authentication token received");
      return;
    }

    // Validate token structure
    const payload = parseJWTPayload(token);
    if (!payload?.userId) {
      setError("Invalid authentication token");
      return;
    }

    // Store token - this triggers the auth-token-changed event
    setAuthToken(token);

    // Small delay to allow the provider to process the token change and reconnect
    // Then navigate - the provider will handle the socket reconnection
    const timer = setTimeout(() => {
      router.replace("/");
    }, 100);

    return () => {
      clearTimeout(timer);
    };
  }, [searchParams, router]);

  if (error) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          p: 2,
        }}
      >
        <Alert severity="error" sx={{ maxWidth: 400 }}>
          <Typography variant="body1" sx={{ mb: 1 }}>
            <strong>Authentication Failed</strong>
          </Typography>
          <Typography variant="body2">{error}</Typography>
        </Alert>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 2,
      }}
    >
      <CircularProgress />
      <Typography color="text.secondary">Completing sign in...</Typography>
    </Box>
  );
}

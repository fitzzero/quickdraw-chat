"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Box, CircularProgress, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import { useSocket } from "../../providers";
import { routeRequiresAuth } from "../../lib/navigation";
import { LoginRequired } from "../feedback";

interface AuthGateProps {
  children: React.ReactNode;
}

/**
 * Wraps page content and shows LoginRequired if the route requires auth
 * and the user is not authenticated.
 */
export function AuthGate({ children }: AuthGateProps): React.ReactElement {
  const t = useTranslations("Common");
  const pathname = usePathname();
  const { isConnected, userId } = useSocket();

  const requiresAuth = routeRequiresAuth(pathname);

  // Still connecting - show loading
  if (!isConnected) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "50vh",
          gap: 2,
        }}
      >
        <CircularProgress />
        <Typography color="text.secondary">{t("connecting")}</Typography>
      </Box>
    );
  }

  // Route requires auth but user is not logged in
  if (requiresAuth && !userId) {
    return <LoginRequired />;
  }

  return <>{children}</>;
}

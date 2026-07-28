"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Box, CircularProgress, Fade, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import { useSocket } from "../../providers";
import { useSlowLoadHint } from "../../hooks";
import { routeRequiresAuth } from "../../lib/navigation";
import { LoginRequired } from "../feedback";

interface AuthGateProps {
  children: React.ReactNode;
}

/**
 * Wraps page content and shows LoginRequired if the route requires auth
 * and the user is not authenticated.
 */
export function AuthGate({ children }: AuthGateProps): React.ReactNode {
  const t = useTranslations("Common");
  const pathname = usePathname();
  const { isConnected, userId } = useSocket();
  // A long connect is (in production) a Cloud Run cold start — say so
  const showWarmingHint = useSlowLoadHint(!isConnected);

  const requiresAuth = routeRequiresAuth(pathname);

  // Public routes render immediately — only auth-gated routes wait for the
  // socket (their pages need the user to decide what to show)
  if (!requiresAuth) {
    return children;
  }

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
        <Fade in={showWarmingHint}>
          <Typography variant="caption" color="text.secondary">
            {t("warmingUp")}
          </Typography>
        </Fade>
      </Box>
    );
  }

  // Route requires auth but user is not logged in
  if (requiresAuth && !userId) {
    return <LoginRequired />;
  }

  return children;
}

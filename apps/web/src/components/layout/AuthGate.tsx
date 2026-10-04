"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Box, CircularProgress, Fade, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import { useSlowLoadHint } from "../../hooks";
import { useQuickdraw } from "../../lib/quickdraw";
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
  // `hello` is the server's answer to this connection's credentials: until it
  // arrives, a null userId means "not known yet", not "signed out". It stays
  // while the socket reconnects, so the page (and what it shows) stays up.
  // quickdraw-5.0 finding: useQuickdraw() has no flag for "the user is known": userId is null both while anonymous and before the hello, isConnected turns true before the hello (and false while reconnecting), and `reconnecting` is not exposed, so a gate ported from 4.x's isConnected/userId flashes LoginRequired or unmounts the page on every reconnect
  const { hello, userId } = useQuickdraw();
  const isKnown = hello !== null;
  // A long connect is (in production) a Cloud Run cold start — say so
  const showWarmingHint = useSlowLoadHint(!isKnown);

  const requiresAuth = routeRequiresAuth(pathname);

  // Public routes render immediately — only auth-gated routes wait for the
  // socket (their pages need the user to decide what to show)
  if (!requiresAuth) {
    return children;
  }

  // Still connecting - show loading
  if (!isKnown) {
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

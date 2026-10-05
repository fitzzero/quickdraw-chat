"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Box, Chip, CircularProgress, Fade, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import { useQuickdraw } from "@fitzzero/quickdraw-core/client";
import { useSlowLoadHint } from "../../hooks";
import { routeRequiresAuth } from "../../lib/navigation";
import { LoginRequired } from "../feedback";

interface AuthGateProps {
  children: React.ReactNode;
}

/** Says the connection is coming back, over the page, which stays as it was meanwhile. */
function ReconnectingNotice({ show }: { show: boolean }): React.ReactElement {
  const t = useTranslations("Common");
  return (
    <Fade in={show} unmountOnExit>
      <Box
        role="status"
        sx={{
          position: "fixed",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: "snackbar",
          pointerEvents: "none",
        }}
      >
        <Chip icon={<CircularProgress size={14} color="inherit" />} label={t("reconnecting")} />
      </Box>
    </Fade>
  );
}

/**
 * Wraps page content and shows LoginRequired if the route requires auth
 * and the user is not authenticated.
 */
export function AuthGate({ children }: AuthGateProps): React.ReactNode {
  const t = useTranslations("Common");
  const pathname = usePathname();
  // isKnown: the server's hello on this connection's credentials arrived, so
  // userId is final (null: signed out). It stays true while the socket
  // reconnects (`reconnecting`), so the page (and what it shows) stays up.
  const { isKnown, userId, reconnecting } = useQuickdraw();
  // A long connect is (in production) a Cloud Run cold start — say so
  const showWarmingHint = useSlowLoadHint(!isKnown);

  const requiresAuth = routeRequiresAuth(pathname);
  const notice = <ReconnectingNotice show={reconnecting} />;

  // Public routes render immediately — only auth-gated routes wait for the
  // socket (their pages need the user to decide what to show)
  if (!requiresAuth) {
    return (
      <>
        {children}
        {notice}
      </>
    );
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
  if (!userId) {
    return <LoginRequired />;
  }

  return (
    <>
      {children}
      {notice}
    </>
  );
}

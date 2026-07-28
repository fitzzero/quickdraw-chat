"use client";

import * as React from "react";
import { Box, CircularProgress, Typography } from "@mui/material";
import { useTranslations } from "next-intl";

/**
 * OAuth landing page. By the time the API redirects here the httpOnly
 * session cookie is already set — a full page load gives the socket a fresh
 * handshake that carries it, so all this page does is hard-navigate to the
 * stored return path (pages set sessionStorage "returnTo" before sending
 * the user to login) or home.
 */
export default function AuthCallbackPage(): React.ReactElement {
  const t = useTranslations("Auth");

  React.useEffect(() => {
    const returnTo = sessionStorage.getItem("returnTo");
    sessionStorage.removeItem("returnTo");
    // Same-origin relative paths only ("/x..." but not protocol-relative "//x")
    const safe = returnTo && /^\/(?!\/)/.test(returnTo) ? returnTo : "/";
    window.location.replace(safe);
  }, []);

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
      <Typography color="text.secondary">{t("completingSignIn")}</Typography>
    </Box>
  );
}

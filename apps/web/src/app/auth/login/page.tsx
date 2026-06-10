"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  Box,
  Paper,
  Typography,
  Button,
  Alert,
  Stack,
  Divider,
  CircularProgress,
} from "@mui/material";
import { useTranslations } from "next-intl";
import { getOAuthUrl, isMockLoginEnabled } from "../../../lib/auth";

// Discord icon SVG
function DiscordIcon(): React.ReactElement {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

// Google "G" icon SVG
function GoogleIcon(): React.ReactElement {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.97 10.97 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

function LoginContent(): React.ReactElement {
  const t = useTranslations("LoginPage");
  const tCommon = useTranslations("Common");
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  const handleDiscordLogin = () => {
    window.location.href = getOAuthUrl("discord");
  };

  const handleGoogleLogin = () => {
    window.location.href = getOAuthUrl("google");
  };

  const handleMockLogin = () => {
    window.location.href = getOAuthUrl("mock");
  };

  const getErrorMessage = (errorCode: string): string => {
    switch (errorCode) {
      case "no_code":
        return t("errorCancelled");
      case "oauth_failed":
        return t("errorFailed");
      default:
        return t("errorGeneric");
    }
  };

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
      <Paper
        elevation={3}
        sx={{
          p: 4,
          maxWidth: 400,
          width: "100%",
          textAlign: "center",
        }}
      >
        <Typography variant="h4" component="h1" gutterBottom>
          {t("title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("subtitle")}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {getErrorMessage(error)}
          </Alert>
        )}

        <Stack spacing={2}>
          <Button
            variant="contained"
            size="large"
            startIcon={<GoogleIcon />}
            onClick={handleGoogleLogin}
            sx={{
              bgcolor: "#fff",
              color: "rgba(0, 0, 0, 0.87)",
              "&:hover": { bgcolor: "#f1f3f4" },
            }}
          >
            {t("continueWithGoogle")}
          </Button>

          <Button
            variant="contained"
            size="large"
            startIcon={<DiscordIcon />}
            onClick={handleDiscordLogin}
            sx={{
              bgcolor: "#5865F2",
              "&:hover": { bgcolor: "#4752C4" },
            }}
          >
            {t("continueWithDiscord")}
          </Button>

          {isMockLoginEnabled() && (
            <>
              <Divider sx={{ my: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  {tCommon("or")}
                </Typography>
              </Divider>

              <Button variant="outlined" size="large" onClick={handleMockLogin}>
                {t("continueAsDemoUser")}
              </Button>
              <Typography variant="caption" color="text.secondary">
                {t("demoLoginHint")}
              </Typography>
            </>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}

// useSearchParams requires a Suspense boundary for prerendering (Next 16)
export default function LoginPage(): React.ReactElement {
  return (
    <React.Suspense
      fallback={
        <Box
          sx={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CircularProgress />
        </Box>
      }
    >
      <LoginContent />
    </React.Suspense>
  );
}

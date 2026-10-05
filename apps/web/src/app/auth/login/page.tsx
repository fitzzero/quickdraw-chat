"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { Box, Paper, Typography, Alert, CircularProgress } from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { SignInOptions } from "../../../components/auth";
import { fetchSignInProviders, SIGN_IN_PROVIDERS_KEY } from "../../../lib/auth";

function LoginContent(): React.ReactElement {
  const t = useTranslations("LoginPage");
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  // The sign-ins the API serves (GET /auth/providers): a button for each of
  // those and no other, since a provider the API has no credentials for
  // answers 404. Asked once more on a failure before saying so.
  const providers = useQuery({
    queryKey: SIGN_IN_PROVIDERS_KEY,
    queryFn: fetchSignInProviders,
    retry: 1,
  });

  // The auth routes' failed sign-ins land here with ?error=denied (the user
  // declined at the provider), failed, or state (an expired or replayed attempt)
  const getErrorMessage = (errorCode: string): string => {
    switch (errorCode) {
      case "denied":
        return t("errorCancelled");
      case "failed":
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

        <SignInOptions
          providers={providers.data}
          // a failed refetch keeps the list it already had
          failed={providers.isError && providers.data === undefined}
          retrying={providers.isFetching}
          onRetry={() => {
            void providers.refetch();
          }}
        />
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

"use client";

import * as React from "react";
import { Box, Typography, Button, Paper } from "@mui/material";
import SearchOffIcon from "@mui/icons-material/SearchOff";
import Link from "next/link";
import { useTranslations } from "next-intl";

interface NotFoundProps {
  message?: string;
  backHref?: string;
  backLabel?: string;
}

export function NotFound({
  message,
  backHref = "/",
  backLabel,
}: NotFoundProps): React.ReactElement {
  const t = useTranslations("NotFound");
  const tCommon = useTranslations("Common");

  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "50vh",
        p: 3,
      }}
    >
      <Paper
        sx={{
          p: 4,
          textAlign: "center",
          maxWidth: 400,
        }}
      >
        <SearchOffIcon
          sx={{
            fontSize: 64,
            color: "text.secondary",
            mb: 2,
          }}
        />
        <Typography variant="h5" gutterBottom>
          {t("title")}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {message ?? t("defaultMessage")}
        </Typography>
        <Button component={Link} href={backHref} variant="outlined">
          {backLabel ?? tCommon("goHome")}
        </Button>
      </Paper>
    </Box>
  );
}

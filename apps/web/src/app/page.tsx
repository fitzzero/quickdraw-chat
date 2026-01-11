"use client";

import * as React from "react";
import { Box, Typography, Paper, Button, Stack } from "@mui/material";
import ChatIcon from "@mui/icons-material/Chat";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSocket } from "../providers";

export default function HomePage(): React.ReactElement {
  const t = useTranslations("HomePage");
  const { userId } = useSocket();

  return (
    <Box sx={{ maxWidth: 800, mx: "auto" }}>
      {/* Hero Section */}
      <Paper
        sx={{
          p: 4,
          textAlign: "center",
          mb: 4,
          background: "linear-gradient(135deg, rgba(124, 58, 237, 0.1) 0%, rgba(6, 182, 212, 0.1) 100%)",
        }}
      >
        <Typography variant="h3" component="h1" gutterBottom sx={{ fontWeight: 700 }}>
          {t("title")}
        </Typography>
        <Typography variant="h6" color="text.secondary" sx={{ mb: 3 }}>
          {t("subtitle")}
        </Typography>
        {userId ? (
          <Button
            component={Link}
            href="/chats"
            variant="contained"
            size="large"
            startIcon={<ChatIcon />}
          >
            {t("goToChats")}
          </Button>
        ) : (
          <Button
            component={Link}
            href="/auth/login"
            variant="contained"
            size="large"
          >
            {t("signInToStart")}
          </Button>
        )}
      </Paper>

      {/* Features Section */}
      <Typography variant="h5" gutterBottom sx={{ fontWeight: 600 }}>
        {t("featuresTitle")}
      </Typography>
      <Stack spacing={2}>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            {t("feature1Title")}
          </Typography>
          <Typography color="text.secondary">
            {t("feature1Desc")}
          </Typography>
        </Paper>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            {t("feature2Title")}
          </Typography>
          <Typography color="text.secondary">
            {t("feature2Desc")}
          </Typography>
        </Paper>
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            {t("feature3Title")}
          </Typography>
          <Typography color="text.secondary">
            {t("feature3Desc")}
          </Typography>
        </Paper>
      </Stack>
    </Box>
  );
}

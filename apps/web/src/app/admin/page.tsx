"use client";

import * as React from "react";
import { Box, Typography, CircularProgress, Paper, Grid } from "@mui/material";
import StorageIcon from "@mui/icons-material/Storage";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAdminServices } from "../../hooks/useAdminServices";

/**
 * Admin dashboard page.
 * Shows a grid of available admin services or redirects to first service.
 */
export default function AdminPage(): React.ReactElement {
  const t = useTranslations("Admin");
  const router = useRouter();
  const { adminServices, isLoading } = useAdminServices();

  // Auto-redirect to first service if only one
  React.useEffect(() => {
    if (!isLoading && adminServices.length === 1) {
      router.replace(`/admin/${adminServices[0].serviceName}`);
    }
  }, [isLoading, adminServices, router]);

  if (isLoading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: 300,
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto" }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600, mb: 1 }}>
          {t("dashboard")}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {t("dashboardDescription")}
        </Typography>
      </Box>

      {/* Service Grid */}
      <Grid container spacing={3}>
        {adminServices.map((service) => (
          <Grid item xs={12} sm={6} md={4} key={service.serviceName}>
            <Paper
              component={Link}
              href={`/admin/${service.serviceName}`}
              sx={{
                p: 3,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textDecoration: "none",
                color: "inherit",
                transition: "all 0.2s",
                "&:hover": {
                  bgcolor: "action.hover",
                  transform: "translateY(-2px)",
                },
              }}
            >
              <Box
                sx={{
                  width: 56,
                  height: 56,
                  borderRadius: 2,
                  bgcolor: "primary.main",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  mb: 2,
                }}
              >
                <StorageIcon sx={{ color: "white", fontSize: 28 }} />
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
                {service.displayName}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t("manageService")}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}

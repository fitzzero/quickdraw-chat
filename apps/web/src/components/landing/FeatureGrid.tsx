"use client";

import * as React from "react";
import { Box, Container, Paper, Typography } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import type { SvgIconComponent } from "@mui/icons-material";
import BoltIcon from "@mui/icons-material/Bolt";
import SecurityIcon from "@mui/icons-material/Security";
import KeyIcon from "@mui/icons-material/Key";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import ScienceIcon from "@mui/icons-material/Science";
import RocketLaunchIcon from "@mui/icons-material/RocketLaunch";
import CallSplitIcon from "@mui/icons-material/CallSplit";
// ── quickdraw-game:start ──
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
// ── quickdraw-game:end ──
import { useTranslations } from "next-intl";

interface Feature {
  key: string;
  icon: SvgIconComponent;
  accent: string;
}

const FEATURES: Feature[] = [
  { key: "featRealtime", icon: BoltIcon, accent: "#7c4dff" },
  { key: "featAcl", icon: SecurityIcon, accent: "#7aa2f7" },
  // ── quickdraw-game:start ──
  { key: "featGame", icon: SportsEsportsIcon, accent: "#f7768e" },
  // ── quickdraw-game:end ──
  { key: "featAuth", icon: KeyIcon, accent: "#e0af68" },
  { key: "featAdmin", icon: AdminPanelSettingsIcon, accent: "#bb9af7" },
  { key: "featTesting", icon: ScienceIcon, accent: "#9ece6a" },
  { key: "featDeploy", icon: RocketLaunchIcon, accent: "#7dcfff" },
  { key: "featFork", icon: CallSplitIcon, accent: "#c0caf5" },
];

const rise = keyframes`
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
`;

export function FeatureGrid(): React.ReactElement {
  const t = useTranslations("Landing");

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 6, md: 9 } }}>
      <Typography variant="overline" color="primary.light" sx={{ display: "block" }}>
        {t("featuresOverline")}
      </Typography>
      <Typography variant="h4" sx={{ fontWeight: 700, mb: 4 }}>
        {t("featuresTitle")}
      </Typography>

      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, 1fr)",
            md: "repeat(4, 1fr)",
          },
        }}
      >
        {FEATURES.map((feature, index) => (
          <Paper
            key={feature.key}
            sx={{
              p: 2.5,
              animation: `${rise} 0.6s ease-out both`,
              animationDelay: `${index * 0.06}s`,
              "@media (prefers-reduced-motion: reduce)": { animation: "none" },
              transition: "border-color 0.2s ease, transform 0.2s ease",
              "&:hover": {
                borderColor: feature.accent,
                transform: "translateY(-2px)",
              },
            }}
          >
            <feature.icon sx={{ color: feature.accent, fontSize: 28, mb: 1.5 }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
              {t(`${feature.key}Title`)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t(`${feature.key}Desc`)}
            </Typography>
          </Paper>
        ))}
      </Box>
    </Container>
  );
}

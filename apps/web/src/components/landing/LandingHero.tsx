"use client";

import * as React from "react";
import Image from "next/image";
import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import { keyframes } from "@mui/material/styles";
import GitHubIcon from "@mui/icons-material/GitHub";
// ── quickdraw-game:start ──
import Link from "next/link";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
// ── quickdraw-game:end ──
import { useTranslations } from "next-intl";
import { GITHUB_URL } from "../../lib/site";
import { SnakeTrailsCanvas } from "./SnakeTrailsCanvas";

const STACK_CHIPS = [
  "Bun",
  "Next.js",
  "MUI",
  "Socket.IO",
  "Prisma",
  // ── quickdraw-game:start ──
  "Godot",
  // ── quickdraw-game:end ──
];

const fadeInUp = keyframes`
  from { opacity: 0; transform: translateY(18px); }
  to { opacity: 1; transform: translateY(0); }
`;

/** Staggered entrance, disabled for prefers-reduced-motion. */
function entrance(order: number): Record<string, unknown> {
  return {
    animation: `${fadeInUp} 0.7s ease-out both`,
    animationDelay: `${order * 0.12}s`,
    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
  };
}

export function LandingHero(): React.ReactElement {
  const t = useTranslations("Landing");

  return (
    <Box
      sx={{
        position: "relative",
        overflow: "hidden",
        minHeight: 480,
        height: "76vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <SnakeTrailsCanvas />

      {/* Soft vignette so copy stays readable over the trails */}
      <Box
        sx={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse at center, rgba(22,22,30,0.82) 0%, rgba(22,22,30,0.35) 55%, transparent 100%)",
          pointerEvents: "none",
        }}
      />

      <Stack
        alignItems="center"
        spacing={2.5}
        sx={{ position: "relative", textAlign: "center", px: 3, pointerEvents: "none" }}
      >
        <Box sx={{ ...entrance(0), filter: "drop-shadow(0 0 24px rgba(124,77,255,0.55))" }}>
          <Image src="/logo.png" alt="" width={104} height={104} priority />
        </Box>

        <Typography
          variant="h2"
          component="h1"
          sx={{
            ...entrance(1),
            fontWeight: 800,
            background: "linear-gradient(100deg, #c0caf5 20%, #bb9af7 55%, #7dcfff 90%)",
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            color: "transparent",
          }}
        >
          {t("title")}
        </Typography>

        <Typography variant="h6" color="text.primary" sx={{ ...entrance(2), maxWidth: 560 }}>
          {t("tagline")}
        </Typography>
        <Typography color="text.secondary" sx={{ ...entrance(2), maxWidth: 620 }}>
          {t("subtitle")}
        </Typography>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{ ...entrance(3), pointerEvents: "auto", pt: 1 }}
        >
          {/* ── quickdraw-game:start ── */}
          <Button
            component={Link}
            href="/game"
            variant="contained"
            size="large"
            startIcon={<SportsEsportsIcon />}
          >
            {t("ctaPlay")}
          </Button>
          {/* ── quickdraw-game:end ── */}
          <Button
            component="a"
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            variant="outlined"
            size="large"
            startIcon={<GitHubIcon />}
          >
            {t("ctaGitHub")}
          </Button>
        </Stack>

        <Stack
          direction="row"
          spacing={1}
          sx={{ ...entrance(4), flexWrap: "wrap", justifyContent: "center", pt: 1 }}
        >
          {STACK_CHIPS.map((name) => (
            <Chip key={name} label={name} variant="outlined" sx={{ color: "text.secondary" }} />
          ))}
        </Stack>
      </Stack>
    </Box>
  );
}

"use client";

import * as React from "react";
import { Box } from "@mui/material";
import { LandingHero, FeatureGrid, QuickStart } from "../components/landing";

/**
 * The landing page — a marketing-shaped mirror of the README, rendered
 * inside the real app shell (the sidebar and its live demo links are part
 * of the pitch). The route is full-bleed (see lib/navigation.ts) and owns
 * its own scroll.
 */
export default function HomePage(): React.ReactElement {
  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
      <LandingHero />
      <FeatureGrid />
      <QuickStart />
    </Box>
  );
}

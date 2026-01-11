"use client";

import { useTheme, useMediaQuery } from "@mui/material";

/**
 * Hook to detect mobile viewport (below md breakpoint = 900px)
 * Use this instead of inline media queries for responsive behavior.
 */
export function useIsMobile(): boolean {
  const theme = useTheme();
  return useMediaQuery(theme.breakpoints.down("md"));
}

"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { Box } from "@mui/material";
import { useIsMobile } from "../../hooks";
import { routeIsFullBleed } from "../../lib/navigation";
import { AppBar, APP_BAR_HEIGHT } from "./AppBar";
import { LeftSidebar } from "./LeftSidebar";
import { RightSidebar } from "./RightSidebar";
import { AuthGate } from "./AuthGate";

interface AppLayoutProps {
  children: React.ReactNode;
}

/**
 * Main application layout with:
 * - Left sidebar (nav) - permanent on desktop, drawer on mobile
 * - Top app bar with breadcrumbs
 * - Right sidebar (context) - optional, set via useRightSidebar hook
 * - Center content area
 */
export function AppLayout({ children }: AppLayoutProps): React.ReactElement {
  const isMobile = useIsMobile();
  // Full-bleed routes (nav config) fill the content area exactly, no padding
  const fullBleed = routeIsFullBleed(usePathname());

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      {/* Left Sidebar */}
      <LeftSidebar appBarHeight={APP_BAR_HEIGHT} />

      {/* Main content area */}
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          // Prevent flex overflow
          minWidth: 0,
        }}
      >
        {/* App Bar */}
        <AppBar />

        {/* Content wrapper */}
        <Box
          sx={{
            display: "flex",
            flex: 1,
            mt: `${APP_BAR_HEIGHT}px`,
            // Full-bleed pages must not stretch the wrapper past the viewport
            ...(fullBleed && { height: `calc(100vh - ${APP_BAR_HEIGHT}px)`, minHeight: 0 }),
          }}
        >
          {/* Main content */}
          <Box
            component="main"
            sx={{
              flex: 1,
              minWidth: 0,
              bgcolor: "background.default",
              ...(fullBleed
                ? {
                    minHeight: 0,
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                  }
                : { p: { xs: 2, md: 3 } }),
            }}
          >
            <AuthGate>{children}</AuthGate>
          </Box>

          {/* Right Sidebar (desktop only, mobile uses drawer) */}
          {!isMobile && <RightSidebar appBarHeight={APP_BAR_HEIGHT} />}
        </Box>
      </Box>

      {/* Right Sidebar Drawer (mobile only) */}
      {isMobile && <RightSidebar appBarHeight={APP_BAR_HEIGHT} />}
    </Box>
  );
}

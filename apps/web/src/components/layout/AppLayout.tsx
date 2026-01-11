"use client";

import * as React from "react";
import { Box } from "@mui/material";
import { useIsMobile } from "../../hooks";
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
          minWidth: 0, // Prevent flex overflow
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
          }}
        >
          {/* Main content */}
          <Box
            component="main"
            sx={{
              flex: 1,
              minWidth: 0,
              p: { xs: 2, md: 3 },
              bgcolor: "background.default",
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

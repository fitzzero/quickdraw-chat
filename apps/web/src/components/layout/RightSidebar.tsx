"use client";

import * as React from "react";
import { Box, SwipeableDrawer, Typography, IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useIsMobile } from "../../hooks";
import { useLayout } from "../../providers";

const DRAWER_WIDTH = 300;

interface RightSidebarProps {
  /** Height of the AppBar to account for */
  appBarHeight?: number;
}

export function RightSidebar({
  appBarHeight = 64,
}: RightSidebarProps): React.ReactElement | null {
  const isMobile = useIsMobile();
  const { rightSidebar, rightDrawerOpen, setRightDrawerOpen } = useLayout();

  const handleClose = (): void => {
    setRightDrawerOpen(false);
  };
  const handleOpen = (): void => {
    setRightDrawerOpen(true);
  };

  // Don't render if no content
  if (!rightSidebar) {
    return null;
  }

  const sidebarContent = (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      {/* Mobile header with close button */}
      {isMobile && (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            p: 2,
            minHeight: appBarHeight,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Typography variant="h6">Details</Typography>
          <IconButton onClick={handleClose} edge="end">
            <CloseIcon />
          </IconButton>
        </Box>
      )}

      {/* Content */}
      <Box sx={{ flex: 1, overflow: "auto" }}>{rightSidebar}</Box>
    </Box>
  );

  // Mobile: SwipeableDrawer
  if (isMobile) {
    return (
      <SwipeableDrawer
        anchor="right"
        open={rightDrawerOpen}
        onClose={handleClose}
        onOpen={handleOpen}
        sx={{
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            bgcolor: "background.paper",
          },
        }}
      >
        {sidebarContent}
      </SwipeableDrawer>
    );
  }

  // Desktop: permanent drawer-like box
  return (
    <Box
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        bgcolor: "background.paper",
        borderLeft: 1,
        borderColor: "divider",
        height: `calc(100vh - ${appBarHeight}px)`,
        position: "sticky",
        top: appBarHeight,
        overflow: "auto",
      }}
    >
      {sidebarContent}
    </Box>
  );
}

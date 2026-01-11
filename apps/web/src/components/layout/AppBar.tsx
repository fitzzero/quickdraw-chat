"use client";

import * as React from "react";
import {
  AppBar as MuiAppBar,
  Toolbar,
  IconButton,
  Box,
  Typography,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import { useIsMobile } from "../../hooks";
import { useLayout } from "../../providers";
import { Breadcrumbs } from "./Breadcrumbs";

const APP_BAR_HEIGHT = 64;
const LEFT_DRAWER_WIDTH = 280;

export function AppBar(): React.ReactElement {
  const isMobile = useIsMobile();
  const { setLeftDrawerOpen, rightSidebar, setRightDrawerOpen } = useLayout();

  const handleOpenLeftDrawer = (): void => {
    setLeftDrawerOpen(true);
  };
  const handleOpenRightDrawer = (): void => {
    setRightDrawerOpen(true);
  };

  return (
    <MuiAppBar
      position="fixed"
      elevation={0}
      sx={{
        borderRadius: 0,
        bgcolor: "background.paper",
        borderBottom: 1,
        borderColor: "divider",
        // On desktop, offset by left drawer width
        width: isMobile ? "100%" : `calc(100% - ${LEFT_DRAWER_WIDTH}px)`,
        ml: isMobile ? 0 : `${LEFT_DRAWER_WIDTH}px`,
      }}
    >
      <Toolbar sx={{ minHeight: APP_BAR_HEIGHT, gap: 1 }}>
        {/* Mobile: Hamburger menu */}
        {isMobile && (
          <IconButton
            edge="start"
            onClick={handleOpenLeftDrawer}
            sx={{ mr: 1 }}
          >
            <MenuIcon />
          </IconButton>
        )}

        {/* Mobile: App logo */}
        {isMobile && (
          <Box
            sx={{
              width: 28,
              height: 28,
              borderRadius: 1,
              bgcolor: "primary.main",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              mr: 1,
            }}
          >
            <Typography sx={{ color: "white", fontWeight: 700, fontSize: 14 }}>
              Q
            </Typography>
          </Box>
        )}

        {/* Breadcrumbs */}
        <Box sx={{ flex: 1 }}>
          <Breadcrumbs />
        </Box>

        {/* Mobile: Right sidebar toggle (only if page has right sidebar) */}
        {isMobile && rightSidebar && (
          <IconButton edge="end" onClick={handleOpenRightDrawer}>
            <HelpOutlineIcon />
          </IconButton>
        )}
      </Toolbar>
    </MuiAppBar>
  );
}

export { APP_BAR_HEIGHT };

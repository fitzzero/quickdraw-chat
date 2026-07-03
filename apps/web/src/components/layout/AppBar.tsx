"use client";

import * as React from "react";
import { AppBar as MuiAppBar, Toolbar, IconButton, Box, Tooltip } from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import GitHubIcon from "@mui/icons-material/GitHub";
import { useTranslations } from "next-intl";
import { useIsMobile } from "../../hooks";
import { useLayout } from "../../providers";
import { GITHUB_URL } from "../../lib/site";
import { Logo } from "../common/Logo";
import { Breadcrumbs } from "./Breadcrumbs";

const APP_BAR_HEIGHT = 64;
const LEFT_DRAWER_WIDTH = 280;

export function AppBar(): React.ReactElement {
  const tCommon = useTranslations("Common");
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
          <IconButton edge="start" onClick={handleOpenLeftDrawer} sx={{ mr: 1 }}>
            <MenuIcon />
          </IconButton>
        )}

        {/* Mobile: App logo */}
        {isMobile && (
          <Box sx={{ display: "flex", alignItems: "center", mr: 1 }}>
            <Logo size={28} />
          </Box>
        )}

        {/* Breadcrumbs */}
        <Box sx={{ flex: 1 }}>
          <Breadcrumbs />
        </Box>

        {/* Source link */}
        <Tooltip title={tCommon("viewOnGitHub")}>
          <IconButton
            component="a"
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={tCommon("viewOnGitHub")}
          >
            <GitHubIcon />
          </IconButton>
        </Tooltip>

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

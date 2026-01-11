"use client";

import * as React from "react";
import {
  Box,
  Drawer,
  SwipeableDrawer,
  List,
  Typography,
  Divider,
} from "@mui/material";
import { useTranslations } from "next-intl";
import { useIsMobile } from "../../hooks";
import { useLayout } from "../../providers";
import { siteNavigation } from "../../lib/navigation";
import { NavAccordion } from "./NavAccordion";
import { UserMenu } from "./UserMenu";

const DRAWER_WIDTH = 280;

interface LeftSidebarProps {
  /** Height of the AppBar to account for */
  appBarHeight?: number;
}

export function LeftSidebar({
  appBarHeight = 64,
}: LeftSidebarProps): React.ReactElement {
  const t = useTranslations("Sidebar");
  const isMobile = useIsMobile();
  const { leftDrawerOpen, setLeftDrawerOpen } = useLayout();

  const handleClose = (): void => {
    setLeftDrawerOpen(false);
  };
  const handleOpen = (): void => {
    setLeftDrawerOpen(true);
  };

  const sidebarContent = (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      {/* App Header */}
      <Box
        sx={{
          p: 2,
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          minHeight: appBarHeight,
        }}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: 1,
            bgcolor: "primary.main",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Typography variant="h6" sx={{ color: "white", fontWeight: 700 }}>
            Q
          </Typography>
        </Box>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {t("appName")}
        </Typography>
      </Box>

      <Divider />

      {/* Navigation */}
      <Box sx={{ flex: 1, overflow: "auto", py: 1 }}>
        <List disablePadding>
          {siteNavigation.map((item) => (
            <NavAccordion
              key={item.id}
              item={item}
              onNavigate={isMobile ? handleClose : undefined}
            />
          ))}
        </List>
      </Box>

      <Divider />

      {/* User Menu */}
      <UserMenu />
    </Box>
  );

  // Mobile: SwipeableDrawer
  if (isMobile) {
    return (
      <SwipeableDrawer
        anchor="left"
        open={leftDrawerOpen}
        onClose={handleClose}
        onOpen={handleOpen}
        sx={{
          "& .MuiDrawer-paper": {
            width: DRAWER_WIDTH,
            bgcolor: "background.paper",
            borderRadius: 0,
          },
        }}
      >
        {sidebarContent}
      </SwipeableDrawer>
    );
  }

  // Desktop: permanent drawer
  return (
    <Drawer
      variant="permanent"
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        "& .MuiDrawer-paper": {
          width: DRAWER_WIDTH,
          bgcolor: "background.paper",
          borderRight: 1,
          borderColor: "divider",
          borderRadius: 0,
        },
      }}
    >
      {sidebarContent}
    </Drawer>
  );
}

"use client";

import * as React from "react";
import {
  Box,
  Drawer,
  SwipeableDrawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
  Divider,
} from "@mui/material";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import StorageIcon from "@mui/icons-material/Storage";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useIsMobile } from "../../hooks";
import { useLayout, useSocket } from "../../providers";
import { AppBar, APP_BAR_HEIGHT } from "../../components/layout/AppBar";
import { RightSidebar } from "../../components/layout/RightSidebar";
import { AuthGate } from "../../components/layout/AuthGate";
import { useAdminServices } from "../../hooks/useAdminServices";
import { NoPermission } from "../../components/feedback";

const DRAWER_WIDTH = 280;

interface AdminLayoutProps {
  children: React.ReactNode;
}

/**
 * Admin layout with admin-specific navigation.
 * Replaces the standard left sidebar with admin service navigation.
 */
export default function AdminLayout({
  children,
}: AdminLayoutProps): React.ReactElement {
  const t = useTranslations("Admin");
  const tCommon = useTranslations("Common");
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const { leftDrawerOpen, setLeftDrawerOpen } = useLayout();
  const { userId } = useSocket();
  const { adminServices, isLoading } = useAdminServices();

  const handleClose = (): void => {
    setLeftDrawerOpen(false);
  };
  const handleOpen = (): void => {
    setLeftDrawerOpen(true);
  };

  // Check if user has any admin access
  const hasAdminAccess = adminServices.length > 0;

  const sidebarContent = (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      {/* Admin Header */}
      <Box
        sx={{
          p: 2,
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          minHeight: APP_BAR_HEIGHT,
        }}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: 1,
            bgcolor: "warning.main",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <AdminPanelSettingsIcon sx={{ color: "white", fontSize: 20 }} />
        </Box>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {t("title")}
        </Typography>
      </Box>

      <Divider />

      {/* Admin Navigation */}
      <Box sx={{ flex: 1, overflow: "auto", py: 1 }}>
        <List disablePadding>
          {adminServices.map((service) => {
            const isActive = pathname === `/admin/${service.serviceName}`;
            return (
              <ListItem key={service.serviceName} disablePadding>
                <ListItemButton
                  component={Link}
                  href={`/admin/${service.serviceName}`}
                  selected={isActive}
                  onClick={isMobile ? handleClose : undefined}
                  sx={{
                    mx: 1,
                    borderRadius: 1,
                    "&.Mui-selected": {
                      bgcolor: "action.selected",
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    <StorageIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText primary={service.displayName} />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      </Box>

      <Divider />

      {/* Back to App Link */}
      <Box sx={{ p: 2 }}>
        <ListItemButton
          component={Link}
          href="/"
          sx={{
            borderRadius: 1,
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <ListItemText
            primary={tCommon("backToApp")}
            primaryTypographyProps={{ variant: "body2" }}
          />
        </ListItemButton>
      </Box>
    </Box>
  );

  // Show loading or no permission states
  if (!userId) {
    return (
      <Box sx={{ display: "flex", minHeight: "100vh" }}>
        <AuthGate>{children}</AuthGate>
      </Box>
    );
  }

  if (!isLoading && !hasAdminAccess) {
    return (
      <Box sx={{ display: "flex", minHeight: "100vh" }}>
        <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <NoPermission />
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      {/* Admin Left Sidebar */}
      {isMobile ? (
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
      ) : (
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
      )}

      {/* Main content area */}
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
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
            {children}
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

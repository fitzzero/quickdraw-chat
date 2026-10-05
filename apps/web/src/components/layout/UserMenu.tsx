"use client";

import * as React from "react";
import {
  Box,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Typography,
  Divider,
  Avatar,
  ButtonBase,
} from "@mui/material";
import PersonIcon from "@mui/icons-material/Person";
import SettingsIcon from "@mui/icons-material/Settings";
import LogoutIcon from "@mui/icons-material/Logout";
import LoginIcon from "@mui/icons-material/Login";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { signOut, useAdminServices, useQuickdraw } from "@fitzzero/quickdraw-core/client";
import { useSlowLoadHint } from "../../hooks";
import { useErrorText } from "../../hooks/useErrorText";
import { useToast } from "../../providers/ToastProvider";
import { qd } from "../../lib/quickdraw";
import { AUTH_ROUTES } from "../../lib/auth";

export function UserMenu(): React.ReactElement {
  const t = useTranslations("UserMenu");
  const tCommon = useTranslations("Common");
  const tAuth = useTranslations("Auth");
  const errorText = useErrorText();
  const { showToast } = useToast();
  // isKnown: the server's hello named the user (userId null: signed out);
  // it stays true while the socket reconnects
  const { userId, isKnown } = useQuickdraw();
  const showWarmingHint = useSlowLoadHint(!isKnown);
  const { data: user } = qd.userService.useEntity(userId);
  // The services whose admin screens answer this user (their adminMeta),
  // asked only where the hello's grants allow it (Admin, the kit's default)
  const { services: adminServices } = useAdminServices(qd, { enabled: userId !== null });
  const hasAdminAccess = adminServices.length > 0;
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleSignOut = async (): Promise<void> => {
    handleClose();
    try {
      // Revokes this session (the API ends its sockets) and clears the cookie
      await signOut(AUTH_ROUTES);
    } catch (error) {
      // Refused or unreachable: the session may still be live, so stay
      showToast(tAuth("signOutFailed", { reason: errorText(error) }), "error");
      return;
    }
    // A full page load: the socket reconnects signed out
    window.location.href = "/";
  };

  // Not connected yet — a long wait is (in production) a cold start
  if (!isKnown) {
    return (
      <Box sx={{ p: 2, opacity: 0.5 }}>
        <Typography variant="body2" color="text.secondary">
          {showWarmingHint ? tCommon("warmingUp") : tCommon("connecting")}
        </Typography>
      </Box>
    );
  }

  // Not logged in
  if (!userId) {
    return (
      <Box sx={{ p: 2 }}>
        <ButtonBase
          component={Link}
          href="/auth/login"
          sx={{
            width: "100%",
            p: 1.5,
            borderRadius: 2,
            justifyContent: "flex-start",
            gap: 1.5,
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <Avatar sx={{ width: 36, height: 36, bgcolor: "primary.main" }}>
            <LoginIcon fontSize="small" />
          </Avatar>
          <Typography variant="body2">{tAuth("signIn")}</Typography>
        </ButtonBase>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <ButtonBase
        onClick={handleOpen}
        sx={{
          width: "100%",
          p: 1.5,
          borderRadius: 2,
          justifyContent: "flex-start",
          gap: 1.5,
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <Avatar
          src={user?.image ?? undefined}
          sx={{ width: 36, height: 36, bgcolor: "primary.main" }}
        >
          {user?.name?.[0]?.toUpperCase() ?? "U"}
        </Avatar>
        <Box sx={{ textAlign: "left", minWidth: 0, flex: 1 }}>
          <Typography variant="body2" noWrap>
            {user?.name ?? tCommon("user")}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {user?.email}
          </Typography>
        </Box>
      </ButtonBase>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: { minWidth: 200 },
          },
        }}
      >
        {hasAdminAccess && [
          <MenuItem key="admin" component={Link} href="/admin" onClick={handleClose}>
            <ListItemIcon>
              <AdminPanelSettingsIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("admin")}</ListItemText>
          </MenuItem>,
          <Divider key="admin-divider" />,
        ]}
        <MenuItem component={Link} href="/profile" onClick={handleClose}>
          <ListItemIcon>
            <PersonIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("profile")}</ListItemText>
        </MenuItem>
        <MenuItem component={Link} href="/account" onClick={handleClose}>
          <ListItemIcon>
            <SettingsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("account")}</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            void handleSignOut();
          }}
        >
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{tAuth("signOut")}</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
}

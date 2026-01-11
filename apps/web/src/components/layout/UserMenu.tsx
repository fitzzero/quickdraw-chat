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
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSocket } from "../../providers";
import { useSubscription } from "../../hooks";
import { clearAuthToken } from "../../lib/auth";

export function UserMenu(): React.ReactElement {
  const t = useTranslations("UserMenu");
  const tCommon = useTranslations("Common");
  const tAuth = useTranslations("Auth");
  const { userId, isConnected } = useSocket();
  const { data: user } = useSubscription("userService", userId ?? "");
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleLogout = () => {
    clearAuthToken();
    handleClose();
    // Force full page reload to clear socket connection
    window.location.href = "/";
  };

  // Not connected yet
  if (!isConnected) {
    return (
      <Box sx={{ p: 2, opacity: 0.5 }}>
        <Typography variant="body2" color="text.secondary">
          {tCommon("connecting")}
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
        <MenuItem onClick={handleLogout}>
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{tAuth("signOut")}</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
}

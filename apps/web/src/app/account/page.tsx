"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Switch,
  Divider,
  Button,
} from "@mui/material";
import NotificationsIcon from "@mui/icons-material/Notifications";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import SecurityIcon from "@mui/icons-material/Security";
import LogoutIcon from "@mui/icons-material/Logout";
import DeleteIcon from "@mui/icons-material/Delete";
import { useTranslations } from "next-intl";
import { useSocket } from "../../providers";
import { useSubscription } from "../../hooks";
import { ConfirmDialog } from "../../components/feedback";
import { logoutAllDevices } from "../../lib/auth";

export default function AccountPage(): React.ReactElement {
  const t = useTranslations("AccountPage");
  const tCommon = useTranslations("Common");
  const router = useRouter();
  const { userId } = useSocket();
  const { data: user } = useSubscription("userService", userId ?? "");
  
  const [showSignOutAllDialog, setShowSignOutAllDialog] = React.useState(false);
  const [isSigningOut, setIsSigningOut] = React.useState(false);

  const handleSignOutAllDevices = async (): Promise<void> => {
    setIsSigningOut(true);
    try {
      await logoutAllDevices();
      router.push("/auth/login");
    } finally {
      setIsSigningOut(false);
      setShowSignOutAllDialog(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 600, mx: "auto" }}>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 600, mb: 3 }}>
        {t("title")}
      </Typography>

      {/* Account Info */}
      <Paper sx={{ mb: 3 }}>
        <Box sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            {t("accountInfoTitle")}
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {t("accountInfoDesc")}
          </Typography>
        </Box>
        <Divider />
        <List disablePadding>
          <ListItem>
            <ListItemText
              primary={t("email")}
              secondary={user?.email ?? tCommon("loading")}
            />
          </ListItem>
          <ListItem>
            <ListItemText
              primary={t("displayName")}
              secondary={user?.name ?? tCommon("notSet")}
            />
          </ListItem>
        </List>
      </Paper>

      {/* Preferences */}
      <Paper sx={{ mb: 3 }}>
        <Box sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            {t("preferencesTitle")}
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {t("preferencesDesc")}
          </Typography>
        </Box>
        <Divider />
        <List disablePadding>
          <ListItem>
            <ListItemIcon>
              <NotificationsIcon />
            </ListItemIcon>
            <ListItemText
              primary={t("notifications")}
              secondary={t("notificationsDesc")}
            />
            <Switch disabled />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <DarkModeIcon />
            </ListItemIcon>
            <ListItemText
              primary={t("darkMode")}
              secondary={t("darkModeDesc")}
            />
            <Switch checked disabled />
          </ListItem>
        </List>
      </Paper>

      {/* Security */}
      <Paper sx={{ mb: 3 }}>
        <Box sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            {t("securityTitle")}
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {t("securityDesc")}
          </Typography>
        </Box>
        <Divider />
        <List disablePadding>
          <ListItem>
            <ListItemIcon>
              <SecurityIcon />
            </ListItemIcon>
            <ListItemText
              primary={t("connectedAccounts")}
              secondary={t("connectedAccountsDesc")}
            />
            <Button variant="outlined" size="small" disabled>
              {tCommon("manage")}
            </Button>
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <LogoutIcon />
            </ListItemIcon>
            <ListItemText
              primary={t("signOutAllDevices")}
              secondary={t("signOutAllDevicesDesc")}
            />
            <Button
              variant="outlined"
              size="small"
              onClick={() => { setShowSignOutAllDialog(true); }}
            >
              {t("signOutAllDevices")}
            </Button>
          </ListItem>
        </List>
      </Paper>

      {/* Sign Out All Devices Confirmation Dialog */}
      <ConfirmDialog
        open={showSignOutAllDialog}
        onClose={() => { setShowSignOutAllDialog(false); }}
        onConfirm={handleSignOutAllDevices}
        title={t("signOutAllDevicesConfirmTitle")}
        message={t("signOutAllDevicesConfirmMessage")}
        confirmLabel={t("signOutAllDevices")}
        destructive
        isLoading={isSigningOut}
      />

      {/* Danger Zone */}
      <Paper sx={{ border: 1, borderColor: "error.main" }}>
        <Box sx={{ p: 3 }}>
          <Typography variant="h6" color="error" gutterBottom>
            {t("dangerZoneTitle")}
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {t("dangerZoneDesc")}
          </Typography>
        </Box>
        <Divider />
        <List disablePadding>
          <ListItem>
            <ListItemIcon>
              <DeleteIcon color="error" />
            </ListItemIcon>
            <ListItemText
              primary={t("deleteAccount")}
              secondary={t("deleteAccountDesc")}
            />
            <Button variant="outlined" color="error" size="small" disabled>
              {tCommon("delete")}
            </Button>
          </ListItem>
        </List>
      </Paper>
    </Box>
  );
}

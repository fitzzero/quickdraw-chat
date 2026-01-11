"use client";

import * as React from "react";
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
import DeleteIcon from "@mui/icons-material/Delete";
import { useSocket } from "../../providers";
import { useSubscription } from "../../hooks";

export default function AccountPage(): React.ReactElement {
  const { userId } = useSocket();
  const { data: user } = useSubscription("userService", userId ?? "");

  return (
    <Box sx={{ maxWidth: 600, mx: "auto" }}>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 600, mb: 3 }}>
        Account Settings
      </Typography>

      {/* Account Info */}
      <Paper sx={{ mb: 3 }}>
        <Box sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Account Information
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Manage your account details and connected services.
          </Typography>
        </Box>
        <Divider />
        <List disablePadding>
          <ListItem>
            <ListItemText
              primary="Email"
              secondary={user?.email ?? "Loading..."}
            />
          </ListItem>
          <ListItem>
            <ListItemText
              primary="Display Name"
              secondary={user?.name ?? "Not set"}
            />
          </ListItem>
        </List>
      </Paper>

      {/* Preferences */}
      <Paper sx={{ mb: 3 }}>
        <Box sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Preferences
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Customize your experience.
          </Typography>
        </Box>
        <Divider />
        <List disablePadding>
          <ListItem>
            <ListItemIcon>
              <NotificationsIcon />
            </ListItemIcon>
            <ListItemText
              primary="Notifications"
              secondary="Receive notifications for new messages"
            />
            <Switch disabled />
          </ListItem>
          <ListItem>
            <ListItemIcon>
              <DarkModeIcon />
            </ListItemIcon>
            <ListItemText
              primary="Dark Mode"
              secondary="Currently always enabled"
            />
            <Switch checked disabled />
          </ListItem>
        </List>
      </Paper>

      {/* Security */}
      <Paper sx={{ mb: 3 }}>
        <Box sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>
            Security
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Manage your security settings.
          </Typography>
        </Box>
        <Divider />
        <List disablePadding>
          <ListItem>
            <ListItemIcon>
              <SecurityIcon />
            </ListItemIcon>
            <ListItemText
              primary="Connected Accounts"
              secondary="Manage OAuth connections"
            />
            <Button variant="outlined" size="small" disabled>
              Manage
            </Button>
          </ListItem>
        </List>
      </Paper>

      {/* Danger Zone */}
      <Paper sx={{ border: 1, borderColor: "error.main" }}>
        <Box sx={{ p: 3 }}>
          <Typography variant="h6" color="error" gutterBottom>
            Danger Zone
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Irreversible actions. Please be careful.
          </Typography>
        </Box>
        <Divider />
        <List disablePadding>
          <ListItem>
            <ListItemIcon>
              <DeleteIcon color="error" />
            </ListItemIcon>
            <ListItemText
              primary="Delete Account"
              secondary="Permanently delete your account and all data"
            />
            <Button variant="outlined" color="error" size="small" disabled>
              Delete
            </Button>
          </ListItem>
        </List>
      </Paper>
    </Box>
  );
}

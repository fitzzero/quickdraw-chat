"use client";

import * as React from "react";
import {
  Box,
  Typography,
  Paper,
  Avatar,
  Skeleton,
  Divider,
  TextField,
  Button,
  IconButton,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import { useTranslations } from "next-intl";
import { useSocket } from "../../providers";
import { useService, useSubscription } from "../../hooks";

export default function ProfilePage(): React.ReactElement {
  const t = useTranslations("ProfilePage");
  const tCommon = useTranslations("Common");
  const { userId } = useSocket();
  const { data: user, isLoading } = useSubscription("userService", userId ?? "");

  const [editing, setEditing] = React.useState(false);
  const [draftName, setDraftName] = React.useState("");
  const [nameError, setNameError] = React.useState<string | null>(null);

  const updateUser = useService("userService", "updateUser", {
    onSuccess: (result) => {
      if ("error" in result) {
        setNameError(t("nameTaken"));
        return;
      }
      // The subscription refreshes the displayed name automatically
      setEditing(false);
      setNameError(null);
    },
  });

  const startEditing = (): void => {
    setDraftName(user?.name ?? "");
    setNameError(null);
    setEditing(true);
  };

  const saveName = (): void => {
    const name = draftName.trim();
    if (!userId || name.length === 0 || name === user?.name) {
      setEditing(false);
      return;
    }
    updateUser.mutate({ id: userId, data: { name } });
  };

  return (
    <Box sx={{ maxWidth: 600, mx: "auto" }}>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 600, mb: 3 }}>
        {t("title")}
      </Typography>

      <Paper sx={{ p: 4 }}>
        {/* Profile Header */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 3, mb: 3 }}>
          {isLoading ? (
            <Skeleton variant="circular" width={80} height={80} />
          ) : (
            <Avatar
              src={user?.image ?? undefined}
              sx={{ width: 80, height: 80, bgcolor: "primary.main", fontSize: 32 }}
            >
              {user?.name?.[0]?.toUpperCase() ?? "U"}
            </Avatar>
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {isLoading ? (
              <>
                <Skeleton variant="text" width={150} height={32} />
                <Skeleton variant="text" width={200} />
              </>
            ) : editing ? (
              <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
                <TextField
                  size="small"
                  value={draftName}
                  onChange={(event) => {
                    setDraftName(event.target.value);
                    setNameError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") saveName();
                    if (event.key === "Escape") setEditing(false);
                  }}
                  error={!!nameError}
                  helperText={nameError}
                  slotProps={{ htmlInput: { maxLength: 50 } }}
                  autoFocus
                />
                <Button
                  variant="contained"
                  size="small"
                  onClick={saveName}
                  disabled={updateUser.isPending}
                  sx={{ mt: 0.25 }}
                >
                  {tCommon("save")}
                </Button>
                <Button size="small" onClick={() => setEditing(false)} sx={{ mt: 0.25 }}>
                  {tCommon("cancel")}
                </Button>
              </Box>
            ) : (
              <>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Typography variant="h5" sx={{ fontWeight: 600 }}>
                    {user?.name ?? tCommon("unknownUser")}
                  </Typography>
                  <IconButton size="small" onClick={startEditing} aria-label={t("editName")}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Box>
                <Typography color="text.secondary">{user?.email}</Typography>
              </>
            )}
          </Box>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* Profile Info */}
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          {t("publicProfileTitle")}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {t("publicProfileDesc")}
        </Typography>

        <Box
          sx={{
            p: 3,
            bgcolor: "background.default",
            borderRadius: 2,
          }}
        >
          <Typography color="text.secondary">{t("displayNameHint")}</Typography>
        </Box>
      </Paper>
    </Box>
  );
}

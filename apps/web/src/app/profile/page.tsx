"use client";

import * as React from "react";
import { Box, Typography, Paper, Avatar, Skeleton, Divider } from "@mui/material";
import { useSocket } from "../../providers";
import { useSubscription } from "../../hooks";

export default function ProfilePage(): React.ReactElement {
  const { userId } = useSocket();
  const { data: user, isLoading } = useSubscription("userService", userId ?? "");

  return (
    <Box sx={{ maxWidth: 600, mx: "auto" }}>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 600, mb: 3 }}>
        Profile
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
          <Box>
            {isLoading ? (
              <>
                <Skeleton variant="text" width={150} height={32} />
                <Skeleton variant="text" width={200} />
              </>
            ) : (
              <>
                <Typography variant="h5" sx={{ fontWeight: 600 }}>
                  {user?.name ?? "Unknown User"}
                </Typography>
                <Typography color="text.secondary">{user?.email}</Typography>
              </>
            )}
          </Box>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* Profile Info */}
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          Public Profile
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          This is how others see your profile. Your email is not visible to other users.
        </Typography>

        <Box
          sx={{
            p: 3,
            bgcolor: "background.default",
            borderRadius: 2,
            textAlign: "center",
          }}
        >
          <Typography color="text.secondary">
            Profile customization coming soon...
          </Typography>
        </Box>
      </Paper>
    </Box>
  );
}

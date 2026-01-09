"use client";

import * as React from "react";
import { Avatar, Skeleton, Tooltip } from "@mui/material";
import { useSubscription } from "../../hooks";

interface UserAvatarProps {
  userId: string;
  size?: number;
  showTooltip?: boolean;
}

/**
 * UserAvatar component that subscribes to real-time user updates.
 * 
 * This component demonstrates subscription deduplication:
 * Multiple UserAvatar components for the same userId will share
 * a single socket subscription, preventing duplicate network traffic.
 */
export function UserAvatar({ userId, size = 40, showTooltip = true }: UserAvatarProps): React.ReactElement {
  const { data: user, isLoading } = useSubscription("userService", userId);

  if (isLoading || !user) {
    return <Skeleton variant="circular" width={size} height={size} />;
  }

  const avatar = (
    <Avatar
      src={user.image ?? undefined}
      sx={{
        width: size,
        height: size,
        bgcolor: "primary.main",
      }}
    >
      {user.name?.[0] ?? "U"}
    </Avatar>
  );

  if (showTooltip && user.name) {
    return (
      <Tooltip title={user.name}>
        {avatar}
      </Tooltip>
    );
  }

  return avatar;
}

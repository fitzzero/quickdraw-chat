"use client";

import * as React from "react";
import { Box, Typography, Button, Paper } from "@mui/material";
import BlockIcon from "@mui/icons-material/Block";
import Link from "next/link";

interface NoPermissionProps {
  message?: string;
}

export function NoPermission({
  message = "You don't have permission to access this resource",
}: NoPermissionProps): React.ReactElement {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "50vh",
        p: 3,
      }}
    >
      <Paper
        sx={{
          p: 4,
          textAlign: "center",
          maxWidth: 400,
        }}
      >
        <BlockIcon
          sx={{
            fontSize: 64,
            color: "error.main",
            mb: 2,
          }}
        />
        <Typography variant="h5" gutterBottom>
          Access Denied
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {message}
        </Typography>
        <Button component={Link} href="/" variant="outlined">
          Go Home
        </Button>
      </Paper>
    </Box>
  );
}

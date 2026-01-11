"use client";

import * as React from "react";
import { Box, Typography, Button, Paper } from "@mui/material";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import Link from "next/link";

interface LoginRequiredProps {
  message?: string;
}

export function LoginRequired({
  message = "Please sign in to view this page",
}: LoginRequiredProps): React.ReactElement {
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
        <LockOutlinedIcon
          sx={{
            fontSize: 64,
            color: "text.secondary",
            mb: 2,
          }}
        />
        <Typography variant="h5" gutterBottom>
          Sign In Required
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {message}
        </Typography>
        <Button
          component={Link}
          href="/auth/login"
          variant="contained"
          size="large"
        >
          Sign In
        </Button>
      </Paper>
    </Box>
  );
}

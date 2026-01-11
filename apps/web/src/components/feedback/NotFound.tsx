"use client";

import * as React from "react";
import { Box, Typography, Button, Paper } from "@mui/material";
import SearchOffIcon from "@mui/icons-material/SearchOff";
import Link from "next/link";

interface NotFoundProps {
  message?: string;
  backHref?: string;
  backLabel?: string;
}

export function NotFound({
  message = "The page you're looking for doesn't exist",
  backHref = "/",
  backLabel = "Go Home",
}: NotFoundProps): React.ReactElement {
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
        <SearchOffIcon
          sx={{
            fontSize: 64,
            color: "text.secondary",
            mb: 2,
          }}
        />
        <Typography variant="h5" gutterBottom>
          Not Found
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {message}
        </Typography>
        <Button component={Link} href={backHref} variant="outlined">
          {backLabel}
        </Button>
      </Paper>
    </Box>
  );
}

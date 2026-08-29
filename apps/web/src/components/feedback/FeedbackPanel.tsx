"use client";

import * as React from "react";
import { Box, Typography, Button, Paper } from "@mui/material";
import type { SvgIconComponent } from "@mui/icons-material";
import Link from "next/link";

interface FeedbackPanelProps {
  /** Rendered above the title. Sized and coloured by the panel. */
  icon: SvgIconComponent;
  /** Any MUI palette token, e.g. "text.secondary" or "error.main". */
  iconColor: string;
  title: string;
  message: string;
  actionHref: string;
  actionLabel: string;
  /** MUI Button variant for the call to action. */
  actionVariant?: "contained" | "outlined";
}

/**
 * The centred icon + title + message + link panel shared by LoginRequired,
 * NoPermission and NotFound. Presentational only: each wrapper resolves its
 * own translation namespace and passes finished strings, so the namespaces
 * stay literal and type-checked.
 */
export function FeedbackPanel({
  icon: Icon,
  iconColor,
  title,
  message,
  actionHref,
  actionLabel,
  actionVariant = "outlined",
}: FeedbackPanelProps): React.ReactElement {
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
        <Icon
          sx={{
            fontSize: 64,
            color: iconColor,
            mb: 2,
          }}
        />
        <Typography variant="h5" gutterBottom>
          {title}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {message}
        </Typography>
        <Button
          component={Link}
          href={actionHref}
          variant={actionVariant}
          size={actionVariant === "contained" ? "large" : "medium"}
        >
          {actionLabel}
        </Button>
      </Paper>
    </Box>
  );
}

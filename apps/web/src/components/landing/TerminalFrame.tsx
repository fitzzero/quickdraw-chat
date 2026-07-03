"use client";

import * as React from "react";
import { Paper, Stack } from "@mui/material";
import CircleIcon from "@mui/icons-material/Circle";

/** Terminal-styled Paper with the traffic-light header. */
export function TerminalFrame({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <Paper sx={{ overflow: "hidden" }}>
      <Stack
        direction="row"
        spacing={0.75}
        sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: "divider" }}
      >
        {["#f7768e", "#e0af68", "#9ece6a"].map((color) => (
          <CircleIcon key={color} sx={{ fontSize: 10, color }} />
        ))}
      </Stack>
      {children}
    </Paper>
  );
}

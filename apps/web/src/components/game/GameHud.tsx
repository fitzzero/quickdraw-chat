"use client";

import * as React from "react";
import { Box, Fade, Paper, Typography } from "@mui/material";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import { useTranslations } from "next-intl";
import { useQuickdraw } from "@fitzzero/quickdraw-core/client";
import { NPC_ID_PREFIX, type LeaderboardEntry } from "@project/shared";
import { qd } from "../../lib/quickdraw";

/**
 * DOM leaderboard overlay above the Godot canvas.
 *
 * React deliberately consumes only the RELIABLE 1Hz world events
 * (leaderboard / death) — the 20Hz volatile world stream stays inside
 * Godot. The page's own socket is in the world's room through GameSurface's
 * watchWorld (signed in or not); useEvent attaches the listener.
 */
export function GameHud(): React.ReactElement | null {
  const t = useTranslations("GameHud");
  const { userId } = useQuickdraw();
  const [board, setBoard] = React.useState<LeaderboardEntry[]>([]);

  qd.gameService.leaderboard.useEvent((entries) => setBoard(entries));

  if (board.length === 0) return null;

  return (
    <Fade in>
      <Paper
        elevation={4}
        sx={{
          position: "absolute",
          top: 16,
          right: 16,
          width: 220,
          px: 2,
          py: 1.5,
          bgcolor: "rgba(20, 23, 30, 0.75)",
          backdropFilter: "blur(6px)",
          pointerEvents: "none",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <EmojiEventsIcon sx={{ fontSize: 18, color: "warning.main" }} />
          <Typography variant="subtitle2" color="common.white">
            {t("leaderboard")}
          </Typography>
        </Box>
        {board.map((entry, index) => {
          const isMe = entry.id === userId;
          const isBot = entry.id.startsWith(NPC_ID_PREFIX);
          return (
            <Box
              key={entry.id}
              sx={{ display: "flex", justifyContent: "space-between", gap: 1, py: 0.25 }}
            >
              <Typography
                variant="body2"
                noWrap
                sx={{ color: isMe ? "primary.light" : "grey.300", fontWeight: isMe ? 700 : 400 }}
              >
                {t("rankedName", {
                  rank: index + 1,
                  name: `${isBot ? "🤖 " : ""}${entry.name ?? t("anonymous")}`,
                })}
              </Typography>
              <Typography variant="body2" sx={{ color: "grey.400", flexShrink: 0 }}>
                {entry.len}
              </Typography>
            </Box>
          );
        })}
      </Paper>
    </Fade>
  );
}

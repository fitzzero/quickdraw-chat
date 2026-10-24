"use client";

import * as React from "react";
import { Box, Fade, Paper, Typography } from "@mui/material";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import { useTranslations } from "next-intl";
import { useQuickdraw } from "@fitzzero/quickdraw-core/client";
import { NPC_ID_PREFIX, type LeaderboardEntry, type PartyLeaderboard } from "@project/shared";
import { qd } from "../../lib/quickdraw";

export interface GameHudProps {
  /**
   * In a party: its latest leaderboard, from its host (null until the
   * first), with each player's round trip and the fair link. Undefined:
   * the world's, from the server.
   */
  party?: { leaderboard: PartyLeaderboard | null };
}

/**
 * DOM leaderboard overlay above the Godot canvas.
 *
 * React deliberately consumes only the RELIABLE 1Hz world events
 * (leaderboard / death) — the 20Hz volatile world stream stays inside
 * Godot. The page's own socket is in the world's room through GameSurface's
 * watchWorld (signed in or not); useEvent attaches the listener. In a party
 * the leaderboard comes from the party's host, on its partyEvents stream.
 */
export function GameHud({ party }: GameHudProps): React.ReactElement | null {
  const t = useTranslations("GameHud");
  const [world, setWorld] = React.useState<LeaderboardEntry[]>([]);

  qd.gameService.leaderboard.useEvent((entries) => setWorld(entries));

  const board = party === undefined ? world : (party.leaderboard?.entries ?? []);
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
            {party === undefined ? t("leaderboard") : t("partyLeaderboard")}
          </Typography>
        </Box>
        {board.map((entry, index) => (
          <HudRow
            key={entry.id}
            entry={entry}
            rank={index + 1}
            rttMs={party?.leaderboard?.rttMs[entry.id]}
          />
        ))}
        {party?.leaderboard && <FairLinkLine leaderboard={party.leaderboard} />}
      </Paper>
    </Fade>
  );
}

/** One leaderboard row: rank, name (🤖 for an NPC), length, and in a party the player's round trip. */
function HudRow({
  entry,
  rank,
  rttMs,
}: {
  entry: LeaderboardEntry;
  rank: number;
  rttMs: number | undefined;
}): React.ReactElement {
  const t = useTranslations("GameHud");
  const { userId } = useQuickdraw();
  const isMe = entry.id === userId;
  const isBot = entry.id.startsWith(NPC_ID_PREFIX);
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1, py: 0.25 }}>
      <Typography
        variant="body2"
        noWrap
        sx={{ color: isMe ? "primary.light" : "grey.300", fontWeight: isMe ? 700 : 400 }}
      >
        {t("rankedName", {
          rank,
          name: `${isBot ? "🤖 " : ""}${entry.name ?? t("anonymous")}`,
        })}
      </Typography>
      <Box sx={{ display: "flex", gap: 1, flexShrink: 0 }}>
        {rttMs !== undefined && (
          <Typography variant="caption" sx={{ color: "grey.500", lineHeight: "20px" }}>
            {t("rtt", { ms: rttMs })}
          </Typography>
        )}
        <Typography variant="body2" sx={{ color: "grey.400" }}>
          {entry.len}
        </Typography>
      </Box>
    </Box>
  );
}

/**
 * The fair link the party's host plays with, once its links were measured:
 * the lag its own user gets, so it reaches the sim no sooner than its players.
 */
function FairLinkLine({
  leaderboard,
}: {
  leaderboard: PartyLeaderboard;
}): React.ReactElement | null {
  const t = useTranslations("GameHud");
  if (Object.keys(leaderboard.rttMs).length === 0) return null;
  return (
    <Typography variant="caption" sx={{ display: "block", mt: 1, color: "grey.500" }}>
      {leaderboard.fairLinkMs === null
        ? t("fairLinkOff")
        : t("fairLink", { ms: leaderboard.fairLinkMs })}
    </Typography>
  );
}

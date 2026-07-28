"use client";

import * as React from "react";
import {
  Avatar,
  Box,
  Chip,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import { useTranslations } from "next-intl";
import { GLOBAL_WORLD_ID } from "@project/shared";
import { useServiceQuery, useSlowLoadHint } from "../../hooks";
import { useSocket } from "../../providers";

const SCORES_PAYLOAD = { worldId: GLOBAL_WORLD_ID, limit: 25 };

/**
 * Public high-scores table. getHighScores is a Public method, so this page
 * works for signed-out visitors — which is also why rows render plain
 * Avatars from the response instead of subscription-backed UserAvatars
 * (anonymous sockets can't subscribe).
 */
export default function ScoresPage(): React.ReactElement {
  const t = useTranslations("ScoresPage");
  const tCommon = useTranslations("Common");
  const { userId, isConnected } = useSocket();
  const { data: scores, isError } = useServiceQuery(
    "gameService",
    "getHighScores",
    SCORES_PAYLOAD,
    { staleTime: 0 },
  );

  const isLoading = scores === undefined && !isError;
  // Public route (no AuthGate): only blame the server while the socket
  // itself is still down — that's the Cloud Run cold start in production
  const showWarmingHint = useSlowLoadHint(isLoading && !isConnected);

  return (
    <Box sx={{ maxWidth: 640, mx: "auto" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 3 }}>
        <EmojiEventsIcon color="warning" fontSize="large" />
        <Typography variant="h4">{t("title")}</Typography>
        {showWarmingHint && (
          <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>
            {tCommon("warmingUp")}
          </Typography>
        )}
      </Box>

      <Paper variant="outlined">
        <Table>
          <TableHead>
            <TableRow>
              <TableCell width={64}>{t("rank")}</TableCell>
              <TableCell>{t("player")}</TableCell>
              <TableCell align="right">{t("best")}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading &&
              Array.from({ length: 5 }, (_, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <Skeleton width={24} />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                      <Skeleton variant="circular" width={32} height={32} />
                      <Skeleton width={140} />
                    </Box>
                  </TableCell>
                  <TableCell align="right">
                    <Skeleton width={40} sx={{ ml: "auto" }} />
                  </TableCell>
                </TableRow>
              ))}

            {scores?.map((row, index) => (
              <TableRow
                key={row.userId}
                sx={row.userId === userId ? { bgcolor: "action.selected" } : undefined}
              >
                <TableCell>
                  <Typography color={index < 3 ? "warning.main" : "text.secondary"}>
                    {index + 1}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                    <Avatar src={row.image ?? undefined} sx={{ width: 32, height: 32 }}>
                      {(row.name ?? "?")[0]}
                    </Avatar>
                    <Typography>{row.name ?? t("anonymous")}</Typography>
                    {row.isGuest && <Chip label={t("guest")} size="small" variant="outlined" />}
                  </Box>
                </TableCell>
                <TableCell align="right">
                  <Typography sx={{ fontWeight: index < 3 ? 700 : 400 }}>
                    {row.bestLength}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}

            {scores?.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} align="center">
                  <Typography color="text.secondary" sx={{ py: 3 }}>
                    {t("empty")}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}

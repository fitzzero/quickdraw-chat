"use client";

import * as React from "react";
import {
  Avatar,
  Box,
  Button,
  CircularProgress,
  Divider,
  Link as MuiLink,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ReplayIcon from "@mui/icons-material/Replay";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import GroupsIcon from "@mui/icons-material/Groups";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { HighScoreEntry } from "@project/shared";

export interface PreGameDialogProps {
  /** "start" before the first spawn, "dead" after a death. */
  mode: "start" | "dead";
  /** Final length of the run that just ended (dead mode). */
  lastRunLength?: number;
  /** Personal best (signed-in players; undefined hides the line). */
  bestLength?: number;
  /** All-time top runs, shown at the bottom of the dialog. */
  topScores: HighScoreEntry[];
  /** Engine ready — Start stays disabled until the world is loaded. */
  canStart: boolean;
  /** True while joinGame/guest-creation is in flight. */
  starting: boolean;
  /** Signed-out visitors get the guest-name flow + login CTA. */
  needsGuest: boolean;
  /** Why the last join was refused, for people: shown, and the button tries again. */
  joinError?: string;
  onStart: (guestName?: string) => void;
  onLogin: () => void;
  /** The party the page is in: its code to share, and whether this page hosts it. */
  party?: { code: string; role: "host" | "guest" };
  /** Hosts a party; with onJoinParty, shows the party section (signed-in players only). */
  onHostParty?: () => void;
  /** Joins a party by the code a player typed. */
  onJoinParty?: (code: string) => void;
  /** Leaves the party, or ends it for its host. */
  onLeaveParty?: () => void;
  /** Hosting or joining in flight. */
  partyBusy?: boolean;
  /** Why the last host or join failed, for people. */
  partyError?: string;
  /** Why the last party ended: its host closed it, or left. */
  partyEnded?: "closed" | "hostLeft" | "ended";
}

/**
 * The pre-game / death dialog — deliberately a plain React overlay driving
 * the game through ordinary quickdraw methods: Start/Respawn call
 * gameService.joinGame / respawn on the PAGE socket while the Godot client
 * (its own socket, same user) renders the world behind it.
 */
function startButtonContent(
  props: PreGameDialogProps,
  t: ReturnType<typeof useTranslations<"GameDialog">>,
): { icon: React.ReactElement; label: string } {
  if (props.starting) {
    return { icon: <CircularProgress size={18} color="inherit" />, label: t("starting") };
  }
  if (props.joinError !== undefined) {
    return { icon: <ReplayIcon />, label: t("tryAgain") };
  }
  if (props.mode === "dead") {
    return { icon: <ReplayIcon />, label: t("respawn") };
  }
  return {
    icon: <PlayArrowIcon />,
    label: props.needsGuest ? t("playAsGuest") : t("start"),
  };
}

export function PreGameDialog(props: PreGameDialogProps): React.ReactElement {
  const t = useTranslations("GameDialog");
  const [guestName, setGuestName] = React.useState("");

  const canSubmit =
    props.canStart && !props.starting && (!props.needsGuest || guestName.trim().length > 0);
  const button = startButtonContent(props, t);

  const handleStart = (): void => {
    if (!canSubmit) return;
    props.onStart(props.needsGuest ? guestName.trim() : undefined);
  };

  return (
    <Box
      sx={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10,
      }}
    >
      <Paper
        elevation={10}
        sx={{
          width: 380,
          maxWidth: "calc(100% - 32px)",
          p: 3,
          textAlign: "center",
          bgcolor: "rgba(20, 23, 30, 0.85)",
          backdropFilter: "blur(10px)",
        }}
      >
        <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
          {props.mode === "dead" ? t("deathTitle") : t("title")}
        </Typography>

        {props.mode === "dead" && props.lastRunLength !== undefined && (
          <Typography color="text.secondary" sx={{ mb: 1 }}>
            {t("lastRun", { length: props.lastRunLength })}
          </Typography>
        )}

        {props.bestLength !== undefined && props.bestLength > 0 && (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              gap: 0.5,
              mb: 1,
            }}
          >
            <EmojiEventsIcon sx={{ fontSize: 18, color: "warning.main" }} />
            <Typography variant="body2" color="text.secondary">
              {t("bestRun", { length: props.bestLength })}
            </Typography>
          </Box>
        )}

        {props.needsGuest && (
          <TextField
            fullWidth
            size="small"
            value={guestName}
            onChange={(event) => setGuestName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") handleStart();
            }}
            placeholder={t("guestNamePlaceholder")}
            slotProps={{ htmlInput: { maxLength: 24 } }}
            sx={{ my: 1.5 }}
            autoFocus
          />
        )}

        {props.joinError !== undefined && (
          <Typography variant="body2" color="error" sx={{ mt: 1.5 }}>
            {t("joinFailed", { reason: props.joinError })}
          </Typography>
        )}

        <Button
          fullWidth
          variant="contained"
          size="large"
          startIcon={button.icon}
          disabled={!canSubmit}
          onClick={handleStart}
          sx={{ mt: props.needsGuest ? 0 : 2 }}
        >
          {button.label}
        </Button>

        {!props.canStart && !props.starting && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            {t("loadingWorld")}
          </Typography>
        )}

        {props.needsGuest && (
          <>
            <Divider sx={{ my: 2 }} />
            <Button fullWidth variant="outlined" onClick={props.onLogin}>
              {t("logIn")}
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
              {t("logInHint")}
            </Typography>
          </>
        )}

        <PartySection {...props} />

        <TopScoresList scores={props.topScores} hidden={props.party !== undefined} />

        <Typography variant="caption" sx={{ display: "block", mt: 2 }}>
          <MuiLink component={Link} href="/scores" color="text.secondary" underline="hover">
            {t("highScores")}
          </MuiLink>
        </Typography>
      </Paper>
    </Box>
  );
}

/** What the dialog says of why the last party ended. */
const PARTY_END_TEXT = {
  closed: "partyClosed",
  hostLeft: "partyHostLeft",
  ended: "partyOver",
} as const satisfies Record<NonNullable<PreGameDialogProps["partyEnded"]>, string>;

/**
 * Playing with friends: in a party, its code to share and the way out;
 * otherwise hosting one, or joining one by its code. A party is hosted by
 * a player's browser (host mode), so a signed-out visitor sees none of it.
 */

function PartySection(props: PreGameDialogProps): React.ReactElement | null {
  const t = useTranslations("GameDialog");
  const [code, setCode] = React.useState("");
  const { party, onHostParty, onJoinParty, onLeaveParty } = props;

  if (party !== undefined) {
    return (
      <>
        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2" color="text.secondary">
          {t(party.role === "host" ? "partyHosting" : "partyJoined")}
        </Typography>
        <Typography variant="h5" sx={{ fontFamily: "monospace", letterSpacing: 2, my: 0.5 }}>
          {party.code}
        </Typography>
        {party.role === "host" && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {t("partyShareHint")}
          </Typography>
        )}
        {onLeaveParty && (
          <Button fullWidth variant="outlined" onClick={onLeaveParty} sx={{ mt: 1.5 }}>
            {t(party.role === "host" ? "endParty" : "leaveParty")}
          </Button>
        )}
      </>
    );
  }
  if (!onHostParty || !onJoinParty) return null;

  const trimmed = code.trim();
  const join = (): void => {
    if (trimmed.length > 0 && !props.partyBusy) onJoinParty(trimmed);
  };
  return (
    <>
      <Divider sx={{ my: 2 }} />
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0.5 }}>
        <GroupsIcon sx={{ fontSize: 18, color: "text.secondary" }} />
        <Typography variant="subtitle2" color="text.secondary">
          {t("playWithFriends")}
        </Typography>
      </Box>
      {props.partyEnded !== undefined && (
        <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
          {t(PARTY_END_TEXT[props.partyEnded])}
        </Typography>
      )}
      <Button
        fullWidth
        variant="outlined"
        disabled={props.partyBusy}
        onClick={onHostParty}
        sx={{ mt: 1.5 }}
      >
        {t("hostParty")}
      </Button>
      <Box sx={{ display: "flex", gap: 1, mt: 1.5 }}>
        <TextField
          size="small"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") join();
          }}
          placeholder={t("partyCodePlaceholder")}
          slotProps={{ htmlInput: { maxLength: 16, "aria-label": t("partyCodeLabel") } }}
          sx={{ flex: 1 }}
        />
        <Button
          variant="outlined"
          disabled={props.partyBusy || trimmed.length === 0}
          onClick={join}
        >
          {t("joinParty")}
        </Button>
      </Box>
      {props.partyError !== undefined && (
        <Typography variant="body2" color="error" sx={{ mt: 1 }}>
          {props.partyError}
        </Typography>
      )}
    </>
  );
}

/** Compact all-time top runs — the /scores page in miniature; hidden in a party, which stores none. */
function TopScoresList({
  scores,
  hidden,
}: {
  scores: HighScoreEntry[];
  hidden: boolean;
}): React.ReactElement | null {
  const t = useTranslations("GameDialog");
  if (hidden || scores.length === 0) return null;
  return (
    <>
      <Divider sx={{ my: 2 }} />
      <Box
        sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 0.5, mb: 1 }}
      >
        <EmojiEventsIcon sx={{ fontSize: 16, color: "warning.main" }} />
        <Typography variant="subtitle2" color="text.secondary">
          {t("topScores")}
        </Typography>
      </Box>
      {scores.map((row, index) => (
        <Box key={row.userId} sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.4 }}>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ width: 16, textAlign: "right", flexShrink: 0 }}
          >
            {index + 1}
          </Typography>
          <Avatar src={row.image ?? undefined} sx={{ width: 22, height: 22, fontSize: 12 }}>
            {row.name?.[0] ?? "?"}
          </Avatar>
          <Typography variant="body2" noWrap sx={{ flex: 1, textAlign: "left" }}>
            {row.name ?? t("anonymous")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
            {row.bestLength}
          </Typography>
        </Box>
      ))}
    </>
  );
}

"use client";

import * as React from "react";
import { Box, CircularProgress, Typography } from "@mui/material";
import { useTranslations } from "next-intl";
import { QuickdrawProvider } from "@fitzzero/quickdraw-core/client";
import { GLOBAL_WORLD_SLUG, type QuickdrawHostConfig } from "@project/shared";
import { GameSurface } from "../game";

/** Discord's proxy rewrites everything through this path prefix. */
const PROXY_SOCKET_PATH = "/.proxy/api/socket.io";
const PROXY_AUTH_URL = "/.proxy/api/auth/discord/activity";

type ActivityPhase =
  | { phase: "sdk" }
  | { phase: "authorizing" }
  | { phase: "ready"; token: string }
  | { phase: "error"; message: string };

/**
 * Discord Activity entry: Embedded App SDK handshake → authorization code →
 * server-side exchange (/.proxy/api/auth/discord/activity) → session JWT →
 * the SAME game components as /game, wired through Discord's proxy.
 *
 * Token-in-handshake is primary here because third-party cookies don't
 * survive the Activity iframe; both the socket provider and the Godot host
 * config carry the JWT explicitly.
 */
export function DiscordActivityShell(): React.ReactElement {
  const t = useTranslations("DiscordActivity");
  const [state, setState] = React.useState<ActivityPhase>({ phase: "sdk" });

  React.useEffect(() => {
    let cancelled = false;

    async function handshake(): Promise<void> {
      const clientId = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
      if (!clientId) {
        throw new Error("NEXT_PUBLIC_DISCORD_CLIENT_ID is not configured");
      }

      const { DiscordSDK } = await import("@discord/embedded-app-sdk");
      const sdk = new DiscordSDK(clientId);
      await sdk.ready();
      if (cancelled) return;

      setState({ phase: "authorizing" });
      const { code } = await sdk.commands.authorize({
        client_id: clientId,
        response_type: "code",
        state: "",
        prompt: "none",
        scope: ["identify"],
      });

      const response = await fetch(PROXY_AUTH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!response.ok) {
        throw new Error(`Auth exchange failed (${response.status})`);
      }
      const { token } = (await response.json()) as { token: string };
      if (!cancelled) setState({ phase: "ready", token });
    }

    handshake().catch((error: unknown) => {
      if (!cancelled) {
        setState({
          phase: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.phase !== "ready") {
    return (
      <Box
        sx={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
          bgcolor: "#14171e",
        }}
      >
        {state.phase === "error" ? (
          <Typography color="error" sx={{ maxWidth: 420, textAlign: "center" }}>
            {state.message}
          </Typography>
        ) : (
          <>
            <CircularProgress />
            <Typography color="grey.500">
              {state.phase === "sdk" ? t("connectingDiscord") : t("authorizing")}
            </Typography>
          </>
        )}
      </Box>
    );
  }

  return (
    <QuickdrawProvider
      serverUrl={window.location.origin}
      socketPath={PROXY_SOCKET_PATH}
      authToken={state.token}
      autoConnect
    >
      <ActivityGame token={state.token} />
    </QuickdrawProvider>
  );
}

function ActivityGame({ token }: { token: string }): React.ReactElement {
  const hostConfig = React.useMemo<QuickdrawHostConfig>(
    () => ({
      apiUrl: window.location.origin,
      socketPath: PROXY_SOCKET_PATH,
      authToken: token,
      worldSlug: GLOBAL_WORLD_SLUG,
    }),
    [token],
  );

  // Discord users are always authenticated (token flow) — no guest flow;
  // the shared GameSurface provides the same dialog/HUD/chat as /game.
  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <GameSurface hostConfig={hostConfig} guestFlow={false} />
    </Box>
  );
}

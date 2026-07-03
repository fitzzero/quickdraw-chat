"use client";

import * as React from "react";
import { DiscordActivityShell } from "../../components/discord/DiscordActivityShell";

/**
 * Discord Activity entry route. Configure your Discord application's
 * Activity URL mappings to point "/" at the web host and "/api" at the API
 * host, then set this route as the Activity entry (see apps/game/README.md).
 *
 * Rendered without the app shell — Providers skips ClientShell and the
 * default socket for /discord (its own provider connects through the proxy).
 */
export default function DiscordActivityPage(): React.ReactElement {
  return <DiscordActivityShell />;
}

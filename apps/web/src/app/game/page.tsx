"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { GameSurface } from "../../components/game";
import { GameCanvas } from "../../game";
import { GLOBAL_WORLD_SLUG, type QuickdrawHostConfig } from "@project/shared";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const HOST_CONFIG: QuickdrawHostConfig = {
  apiUrl: API_URL,
  worldSlug: GLOBAL_WORLD_SLUG,
  // Cookie auth: the browser attaches the session cookie to Godot's
  // websocket handshake — no token needed on the plain web route.
  authToken: null,
};

const BENCH_ALLOWED =
  process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_ENABLE_BENCH === "1";

export default function GamePage(): React.ReactElement {
  // useSearchParams requires a Suspense boundary for static generation
  return (
    <React.Suspense
      fallback={
        <GameSurface hostConfig={HOST_CONFIG} guestFlow guestAuthUrl={`${API_URL}/auth/guest`} />
      }
    >
      <GamePageInner />
    </React.Suspense>
  );
}

function GamePageInner(): React.ReactElement {
  const params = useSearchParams();
  const benchApi = params.get("benchApi");
  const benchUser = params.get("benchUser");

  if (BENCH_ALLOWED && params.get("bench") === "1" && benchApi && benchUser) {
    return <BenchSurface apiUrl={benchApi} userId={benchUser} />;
  }
  return (
    <GameSurface
      hostConfig={HOST_CONFIG}
      guestFlow
      guestAuthUrl={`${API_URL}/auth/guest`}
      // a party's host plays over an unlagged link with ?fairLink=off (A/B play)
      fairLink={params.get("fairLink") !== "off"}
    />
  );
}

/**
 * Netcode-bench mode (dev-gated, driven by apps/bench-web via Playwright):
 * the bare game client, no dialogs, HUD or page socket. The page defines the
 * telemetry sink BEFORE the client starts; the client opens a connection of
 * its own through the latency proxy (`benchApi`) with dev-credential auth,
 * joins and respawns itself, and streams telemetry into
 * window.QuickdrawBench for the runner to drain.
 */
function BenchSurface({ apiUrl, userId }: { apiUrl: string; userId: string }): React.ReactElement {
  if (typeof window !== "undefined" && !window.QuickdrawBench) {
    window.QuickdrawBench = {
      batches: [],
      push(json: string) {
        this.batches.push(JSON.parse(json));
      },
      drain() {
        const drained = this.batches;
        this.batches = [];
        return drained;
      },
    };
  }

  const bench = React.useMemo(() => ({ apiUrl, userId }), [apiUrl, userId]);
  return <GameCanvas bootstrap={null} bench={bench} />;
}

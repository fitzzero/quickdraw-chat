"use client";

/**
 * The React bridge between a party's host-served feeds and the game client
 * (host mode): three components with no DOM, each over one hook of the
 * typed client. `useStream` of `partyWorld` and `partyEvents` and
 * `useChannel` of `partyInput` reach the room's host over the link the
 * client opens, with no change in the app; each new item is handed to the
 * PartyTransport, which feeds the core. When the core asks for a keyframe,
 * the world feed is held off (`enabled` false) for a moment and held again:
 * its next subscription answers a fresh seed, the world now, which replaces
 * the list.
 *
 * quickdraw-5.0 finding: the typed client has no React-free API for a
 * host-served stream or channel, so a 20 Hz feed crosses React state here
 * (about twenty re-renders a second of components that render nothing);
 * and a stream has no refresh, so the ask toggles the hook, and the pause
 * must outlast a macrotask: the client closes a released feed on a 0 ms
 * timer, and a feed released and held again within one commit keeps its
 * subscription (a remount would answer the same list again). The quickdraw
 * card `client-core-streams-channels-and-events-without-react-host-s` asks
 * for the API; when it ships, PartyTransport subscribes itself and this
 * file goes.
 */

import * as React from "react";
import { useNewItems } from "../hooks/useNewItems";
import { qd } from "../lib/quickdraw";
import type { PartyTransport } from "./wire/partyTransport";

/** The members the bridge reads: the app's client, or a mock in a test. */
export type PartyClient = Pick<typeof qd, "gameService">;

export interface PartyWireProps {
  worldId: string;
  transport: PartyTransport;
  /** False until the feeds may subscribe (a host's own page subscribes once it serves). */
  enabled: boolean;
  client?: PartyClient;
}

/** Snapshots the world feed keeps: a few frames' worth between effects (each is handed on once). */
const WORLD_ITEMS = 64;
/** How long a keyframe ask holds the world feed off: past the macrotask on which the client closes a released feed. */
const RESEED_PAUSE_MS = 10;
/** Events the events feed keeps: the seed names every player. */
const EVENT_ITEMS = 128;

export function PartyWire({
  worldId,
  transport,
  enabled,
  client = qd,
}: PartyWireProps): React.ReactElement {
  const [paused, setPaused] = React.useState(false);
  const reseed = React.useCallback(() => setPaused(true), []);
  React.useEffect(() => {
    if (!paused) return undefined;
    const timer = window.setTimeout(() => setPaused(false), RESEED_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [paused]);
  return (
    <>
      <WorldFeed
        worldId={worldId}
        transport={transport}
        enabled={enabled && !paused}
        client={client}
      />
      <EventsFeed worldId={worldId} transport={transport} enabled={enabled} client={client} />
      <InputFeed transport={transport} enabled={enabled} reseed={reseed} client={client} />
    </>
  );
}

interface FeedProps {
  worldId: string;
  transport: PartyTransport;
  enabled: boolean;
  client: PartyClient;
}

/** The host's snapshots, each once; a seed (no send time) is a keyframe. */
function WorldFeed({ worldId, transport, enabled, client }: FeedProps): null {
  const { items, error } = client.gameService.partyWorld.useStream(worldId, {
    max: WORLD_ITEMS,
    enabled,
  });
  useNewItems(items, (item) => transport.item(item));
  useFeedError(transport, error);
  return null;
}

/** The host's events, in order: the seed names every player, a new link's seed names them again. */
function EventsFeed({ worldId, transport, enabled, client }: FeedProps): null {
  const { items, error } = client.gameService.partyEvents.useStream(worldId, {
    max: EVENT_ITEMS,
    enabled,
  });
  useNewItems(items, (event) => transport.event(event));
  useFeedError(transport, error);
  return null;
}

/** A refused feed (no host serves the room, or it refused this user) reaches the client. */
function useFeedError(transport: PartyTransport, error: Error | null): void {
  React.useEffect(() => {
    if (error !== null) transport.failed(error);
  }, [transport, error]);
}

/** The player's input to the host, and the way to ask the world feed for a fresh seed. */
function InputFeed({
  transport,
  enabled,
  reseed,
  client,
}: {
  transport: PartyTransport;
  enabled: boolean;
  reseed: () => void;
  client: PartyClient;
}): null {
  const { send, isReady } = client.gameService.partyInput.useChannel();
  React.useEffect(() => {
    transport.attach({ send: enabled && isReady ? send : null, reseed });
    return () => transport.detach();
  }, [transport, send, isReady, enabled, reseed]);
  return null;
}

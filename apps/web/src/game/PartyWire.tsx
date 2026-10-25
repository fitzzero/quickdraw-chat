"use client";

/**
 * The React bridge between a party's host-served feeds and the game client
 * (host mode): three components with no DOM, each over one hook of the
 * typed client. `useStream` of `partyWorld` and `partyEvents` and
 * `useChannel` of `partyInput` reach the room's host over the link the
 * client opens, with no change in the app; each new item is handed to the
 * PartyTransport, which feeds the core. The world feed remounts (its key)
 * when the core asks for a keyframe: a fresh subscription answers a fresh
 * seed, the world now.
 *
 * quickdraw-5.0 finding: the typed client has no React-free API for a
 * host-served stream or channel, so a 20 Hz feed crosses React state here
 * (about twenty re-renders a second of components that render nothing).
 * The quickdraw card `client-core-streams-channels-and-events-without-react-host-s`
 * asks for the API; when it ships, PartyTransport subscribes itself and
 * this file goes.
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

/** Snapshots the world feed keeps: enough to survive a few frames between effects without losing the seed. */
const WORLD_ITEMS = 64;
/** Events the events feed keeps: the seed names every player. */
const EVENT_ITEMS = 128;

export function PartyWire({
  worldId,
  transport,
  enabled,
  client = qd,
}: PartyWireProps): React.ReactElement {
  const [generation, setGeneration] = React.useState(0);
  const reseed = React.useCallback(() => setGeneration((g) => g + 1), []);
  return (
    <>
      <WorldFeed
        key={generation}
        worldId={worldId}
        transport={transport}
        enabled={enabled}
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

/** The host's snapshots; the first item of a fresh list is the seed's keyframe. */
function WorldFeed({ worldId, transport, enabled, client }: FeedProps): null {
  const { items } = client.gameService.partyWorld.useStream(worldId, {
    max: WORLD_ITEMS,
    enabled,
  });
  useNewItems(items, (item, first) => transport.item(item, first));
  return null;
}

/** The host's events, in order: the seed names every player, a new link's seed names them again. */
function EventsFeed({ worldId, transport, enabled, client }: FeedProps): null {
  const { items } = client.gameService.partyEvents.useStream(worldId, {
    max: EVENT_ITEMS,
    enabled,
  });
  useNewItems(items, (event) => transport.event(event));
  return null;
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

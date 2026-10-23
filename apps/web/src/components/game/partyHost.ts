"use client";

/**
 * A party's host, in the host's own page (host mode): the party's sim and
 * loop (PartyWorld, from @project/shared), served to the party's players
 * over peer links with defineHost while the server names this page's
 * socket the room's host (`qd:host`). The page hears who plays from the
 * server (partyPlayer, partyPlayerLeft) and each player's input from the
 * player's link (partyInput), and pushes partyWorld and partyEvents.
 *
 * Ticks come from a Worker: a hidden tab throttles the page's own timers to
 * about once a second, and a dedicated worker's not, so the party keeps its
 * 20 Hz while the host looks at another tab. Its players' snakes coast
 * through a stall of their own as on the server's world, and so does the
 * host's when its game's tab is hidden (the input queue bounds the burst
 * that follows).
 *
 * The fair link: the host's own user plays over its game's link to this
 * page, which no network slows. Without a lag its input reaches the sim at
 * once while its players' wait a trip, and it wins every head-to-head. So
 * every 5 s the page lags both of its own user's links (its game's, and
 * this page's own in-process one) by the median of the players' one-way
 * trips (settleFairLink), at most 100 ms. `?fairLink=off` on /game turns it
 * off.
 */

import * as React from "react";
import { defineHost, hostOf, onHostChange, useQuickdraw } from "@fitzzero/quickdraw-core/client";
import type { Host } from "@fitzzero/quickdraw-core/client";
import {
  FAIR_LINK_EVERY_MS,
  GAME_TICK_RATE,
  PartyWorld,
  gameContract,
  partyRoom,
  settleFairLink,
} from "@project/shared";
import { qd } from "../../lib/quickdraw";

/** What the host's page knows of the party it hosts. */
export interface PartyHosting {
  /** True while this page serves the party: its own feeds of it may subscribe then. */
  readonly serving: boolean;
}

/**
 * The tick timer, as a worker's source: one message per tick, on a fixed
 * grid of GAME_TICK_RATE a second from its first tick (each timeout aims at
 * the next grid point, so lateness does not add up), starting the grid
 * again after a stall of more than a tick, as GameLoop's own timer does.
 */
const TICKER_SOURCE = `
const period = 1000 / ${GAME_TICK_RATE};
let next = performance.now() + period;
function tick() {
  const now = performance.now();
  next += period;
  if (next < now - period) next = now;
  setTimeout(tick, Math.max(0, next - now));
  postMessage(0);
}
setTimeout(tick, period);
`;

/** Starts the worker that ticks the party; returns its stop. */
function startTicker(onTick: () => void): () => void {
  const url = URL.createObjectURL(new Blob([TICKER_SOURCE], { type: "text/javascript" }));
  const worker = new Worker(url);
  worker.addEventListener("message", onTick);
  return () => {
    worker.terminate();
    URL.revokeObjectURL(url);
  };
}

/**
 * Hosts the party `worldId` while this page's socket is its host: runs its
 * world and serves it. Null hosts nothing. Answers whether it serves (the
 * party's leaderboard carries what the links measure, every 5 s). Once it
 * served, `onLost` hears the socket stop being the host (a reconnect is a
 * new socket, which no longer is: the server ended the party).
 */
// oxlint-disable-next-line max-lines-per-function -- one effect: the world, its host, its timers
export function usePartyHost(
  worldId: string | null,
  fairLink: boolean,
  onLost: () => void,
): PartyHosting {
  const { connection, userId } = useQuickdraw();
  const [serving, setServing] = React.useState(false);
  /** The world hosted now, which the server's events reach. */
  const world = React.useRef<PartyWorld | null>(null);
  /** Read at each measure, so turning the fair link off starts no new world. */
  const fair = React.useRef(fairLink);
  const lost = React.useRef(onLost);
  React.useEffect(() => {
    fair.current = fairLink;
    lost.current = onLost;
  });

  // The server's word on who plays; only the host's page acts on it
  qd.gameService.partyPlayer.useEvent((player) => {
    if (player.worldId === worldId) world.current?.play(player.id, player.name);
  });
  qd.gameService.partyPlayerLeft.useEvent((left) => {
    if (left.worldId === worldId) world.current?.leave(left.id);
  });

  React.useEffect(() => {
    if (worldId === null || userId === null) return undefined;
    const room = partyRoom(worldId);
    let host: Host<typeof gameContract> | undefined;
    const party = new PartyWorld({
      emit: {
        world: (snapshot) => host?.stream("partyWorld").push(worldId, snapshot),
        event: (event) => host?.stream("partyEvents").push(worldId, event),
      },
    });
    // each message is that player's word: the sim steers only the snake of
    // the user the server named for the link
    const served = defineHost(gameContract, {
      channels: { partyInput: (payload, { peer }) => party.input(peer.userId, payload.frames) },
      streams: {
        partyWorld: { seed: () => [party.keyframe()] },
        partyEvents: { seed: () => party.seedEvents() },
      },
    });
    // serves while the server names this socket the room's host (a reconnect
    // is a new socket, which no longer is: the party has ended)
    const settle = (): void => {
      const hosting = hostOf(connection, room) === connection.socket.id;
      if (hosting && host === undefined) {
        host = served.serve(connection, { room });
        setServing(true);
      } else if (!hosting && host !== undefined) {
        host.close();
        host = undefined;
        setServing(false);
        lost.current();
      }
    };
    const stopHostChange = onHostChange(connection, (changed) => {
      if (changed === room) settle();
    });
    settle();
    world.current = party;
    const stopTicker = startTicker(() => {
      if (host !== undefined) party.tick();
    });
    const measure = window.setInterval(() => {
      if (host === undefined) return;
      const measured = settleFairLink(host.peers, userId, fair.current);
      party.setLinks({ ...measured.rttMs }, measured.fairLinkMs);
    }, FAIR_LINK_EVERY_MS);
    return () => {
      window.clearInterval(measure);
      stopTicker();
      stopHostChange();
      host?.close();
      world.current = null;
      setServing(false);
    };
  }, [connection, worldId, userId]);

  return { serving };
}

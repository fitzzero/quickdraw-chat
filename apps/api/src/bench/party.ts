/**
 * A party scenario's run (host mode, Tier 1): no server. A party's host in
 * process (PartyWorld: the shared sim and loop, on the loop's own timers,
 * its ticks the ground truth) and one loopback link per bot (core's
 * createLoopbackPeerLink, the scenario's lag and loss on both ends). The
 * host's own user's bot plays over the host link: as laggy as the players'
 * (the fair link, which the web page sets from its players' round trips and
 * the harness knows), or 0 ms for the advantage the fair link removes.
 *
 * The bots and the host exchange the app's payloads over the ends (input
 * and snapshots on `fast`, the party's events and keyframes on `rel`). The
 * party's server (joinParty, playParty and its partyPlayer) is this module:
 * a bot that joins or respawns is spawned at once.
 */

import type { PeerLink } from "@fitzzero/quickdraw-core/client/core";
import { createLoopbackPeerLink } from "@fitzzero/quickdraw-core/testing";
import type { RunTraces, Scenario } from "@project/bench";
import { deriveSeed, mulberry32 } from "@project/bench";
import type { GameTunables } from "@project/shared";
import { DEFAULT_TUNABLES, GAME_TICK_RATE, PARTY_TUNABLES, PartyWorld } from "@project/shared";
import { BotClient } from "./bot/client.js";
import { PartyTransport, type KeyframeReply } from "./bot/party-transport.js";
import { createGroundTruthRecorder } from "./ground-truth.js";

/** The party's room, as the loopback ends name it. */
const ROOM = "party:bench";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** A player's user id: no database here, only the trace's names. */
const userOf = (name: string): string => `party-${name}`;

/** The host's end hears a bot: its input (`fast`), or an ask for the world now (`rel`). */
function hear(world: PartyWorld, end: PeerLink, userId: string, data: unknown): void {
  if (typeof data !== "object" || data === null) return;
  if ("frames" in data && Array.isArray(data.frames)) {
    world.input(userId, data.frames);
  } else if ("want" in data && data.want === "keyframe") {
    const reply: KeyframeReply = { keyframe: world.keyframe() };
    end.send("rel", reply);
  }
}

/** Plays one run of a party scenario: the host's ticks and every bot's trace. */
export async function executePartyRun(scenario: Scenario): Promise<RunTraces> {
  const party = scenario.party;
  if (party === undefined) throw new Error(`${scenario.name} is no party scenario`);
  const recorder = createGroundTruthRecorder();
  /** The host's end of every bot's link. */
  const ends: PeerLink[] = [];
  const world = new PartyWorld({
    seed: scenario.seed,
    tunables: scenario.tunables ?? {},
    onTick: recorder.onTick,
    emit: {
      world: (snapshot) => {
        for (const end of ends) end.send("fast", snapshot);
      },
      event: (event) => {
        for (const end of ends) end.send("rel", event);
      },
    },
  });
  recorder.seedFood(world.keyframe());
  const tunables: GameTunables = { ...DEFAULT_TUNABLES, ...PARTY_TUNABLES, ...scenario.tunables };
  const bounds = { w: tunables.worldWidth, h: tunables.worldHeight };

  const bots = scenario.clients.map((spec) => {
    const userId = userOf(spec.name);
    const lag = spec.name === party.host ? (party.hostLink ?? party.link) : party.link;
    const [hostEnd, botEnd] = createLoopbackPeerLink({
      ...lag,
      room: ROOM,
      ends: [
        { socketId: "host", userId: userOf(party.host) },
        { socketId: spec.name, userId },
      ],
      random: mulberry32(deriveSeed(scenario.seed, `link:${spec.name}`)),
    });
    ends.push(hostEnd);
    hostEnd.on("message", (data) => hear(world, hostEnd, userId, data));
    const transport = new PartyTransport(botEnd, {
      bounds,
      play: () => world.play(userId, spec.name),
      own: () => world.keyframe().players.find((snap) => snap.id === userId),
    });
    return new BotClient({
      transport,
      userId,
      name: spec.name,
      behaviorKind: spec.behavior.kind,
      ...(spec.render ? { render: spec.render } : {}),
      ...(spec.clockScale === undefined ? {} : { clockScale: spec.clockScale }),
      scenario,
      tunables,
      tickRate: GAME_TICK_RATE,
    });
  });

  world.start();
  try {
    // Joins a little apart, as on the server's world
    for (const bot of bots) {
      await bot.start();
      await sleep(150);
    }
    await sleep(scenario.durationMs);
    // A keyframe the end of the run would cut in half is no lost food
    await Promise.all(bots.map((b) => b.foodSettled(1_000)));
    const clients = bots.map((b) => b.stop());
    return { server: recorder.trace(), clients };
  } finally {
    for (const bot of bots) bot.stop();
    world.stop();
  }
}

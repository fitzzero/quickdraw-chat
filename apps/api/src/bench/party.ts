/**
 * A party scenario's run (host mode, Tier 1): no server. A party's host in
 * process (PartyWorld: the shared sim and loop, on the loop's own timers,
 * its ticks the ground truth) and one loopback link per bot (core's
 * createLoopbackPeerLink, the scenario's lag and loss on both ends). The
 * host's own user's bot plays over a local link (its game runs on the
 * host's machine), which the harness lags as the host's page does: every
 * FAIR_LINK_EVERY_MS by the other players' median one-way trip
 * (settleFairLink, the page's own), or never, for the advantage the fair
 * link removes.
 *
 * The bots and the host exchange the app's payloads over the ends (input
 * and snapshots on `fast`, the party's events and keyframes on `rel`). The
 * party's server (joinParty, playParty and its partyPlayer) is this module:
 * a bot that joins or respawns is spawned at once.
 */

import type { PeerLink } from "@fitzzero/quickdraw-core/client/core";
import { createLoopbackPeerLink } from "@fitzzero/quickdraw-core/testing";
import type { PartySpec, RunTraces, Scenario } from "@project/bench";
import { deriveSeed, mulberry32 } from "@project/bench";
import type { GameTunables, LaggablePeer } from "@project/shared";
import {
  DEFAULT_TUNABLES,
  FAIR_LINK_EVERY_MS,
  GAME_TICK_RATE,
  PARTY_TUNABLES,
  PartyWorld,
  settleFairLink,
} from "@project/shared";
import { BotClient } from "./bot/client.js";
import { PartyTransport, type KeyframeReply } from "./bot/party-transport.js";
import { createGroundTruthRecorder } from "./ground-truth.js";

/** The party's room, as the loopback ends name it. */
const ROOM = "party:bench";

/**
 * Where every bot's input clock starts against the host's tick grid (ms
 * after a tick), one phase for all. A bot's ack waits for the host's next
 * tick, so bots whose clocks step at different phases differ by up to a
 * tick on equal links; joins in a fixed order over seeded links would give
 * each bot the same phase run after run. At 10 ms its frames reach the host
 * mid-tick, on average.
 */
const INPUT_PHASE_MS = 10;

/** The host's own user's link: its game runs on the host's machine. */
const LOCAL_LINK = { ms: 0, jitter: 0, loss: 0 };

/** A party scenario's spec, checked: every bot plays over the party's links, the host's user among them. */
function partyOf(scenario: Scenario): PartySpec {
  const { party } = scenario;
  if (party === undefined) throw new Error(`${scenario.name} is no party scenario`);
  if (!scenario.clients.some((spec) => spec.name === party.host)) {
    throw new Error(`${scenario.name}: no client is the host's own user, ${party.host}`);
  }
  const proxied = scenario.clients.find((spec) => spec.net !== undefined);
  if (proxied !== undefined) {
    throw new Error(`${scenario.name}: ${proxied.name} has a net, which a party's links replace`);
  }
  return party;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** A player's user id: no database here, only the trace's names. */
const userOf = (name: string): string => `party-${name}`;

/**
 * Sets the fair link as the host's page does, every FAIR_LINK_EVERY_MS:
 * first at half the period (the page's first is at a whole one), so the
 * measured window, after warmupMs, starts with it set. Returns its stop.
 */
function startFairLink(peers: readonly LaggablePeer[], party: PartySpec): () => void {
  const settle = (): void => {
    settleFairLink(peers, userOf(party.host), party.fairLink);
  };
  const first = setTimeout(settle, FAIR_LINK_EVERY_MS / 2);
  const every = setInterval(settle, FAIR_LINK_EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}

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
  const party = partyOf(scenario);
  const recorder = createGroundTruthRecorder();
  /** The host's end of every bot's link. */
  const ends: PeerLink[] = [];
  /** The host's ends as its page's peers: each player's user, and the link the fair link lags. */
  const peers: LaggablePeer[] = [];
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
  const tickMs = 1000 / GAME_TICK_RATE;
  /** When the host's loop started: it ticks on a fixed grid from then. */
  let gridStart = 0;
  const aligned = (): Promise<void> => {
    const since = performance.now() - gridStart - INPUT_PHASE_MS;
    return sleep((((tickMs - since) % tickMs) + tickMs) % tickMs);
  };

  const bots = scenario.clients.map((spec) => {
    const userId = userOf(spec.name);
    const lag = spec.name === party.host ? LOCAL_LINK : party.link;
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
    peers.push({ userId, link: hostEnd });
    hostEnd.on("message", (data) => hear(world, hostEnd, userId, data));
    const transport = new PartyTransport(botEnd, {
      bounds,
      aligned,
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
      ...(spec.remotes === undefined ? {} : { remotes: spec.remotes }),
      scenario,
      tunables,
      tickRate: GAME_TICK_RATE,
    });
  });

  world.start();
  gridStart = performance.now();
  const stopFairLink = startFairLink(peers, party);
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
    stopFairLink();
    for (const bot of bots) bot.stop();
    world.stop();
  }
}

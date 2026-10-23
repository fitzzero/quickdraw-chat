/**
 * The headless two-client Godot check: `bun run check:godot` (Godot 4.7 as
 * `godot` on the PATH, or GODOT=/path/to/godot).
 *
 * Boots the API's real services on the bench server (PGlite, the game loop
 * running, development sign-in), runs two copies of the real game headless
 * (apps/game/godot, main scene and autoloads, through test/session.gd, which
 * steers each local snake to the world's centre and prints PROBE lines), and
 * checks a whole session on protocol v5:
 *
 *   1. both join (hello → world stream → joinGame) as their own users;
 *   2. each sees the other's snake move: drawn where the world stream's
 *      snapshots, interpolated on the world clock, put it;
 *   3. a death reaches both (the snakes meet in the centre), and the dead
 *      player respawns;
 *   4. the leaderboard reaches both, naming both players;
 *   5. each holds the server's food: each tick's change applied once, from
 *      the window every snapshot repeats;
 *   6. ada's main scene misses a second of snapshots (QD_FOOD_BLACKOUT, more
 *      than the window): it asks for a keyframe and holds the server's food
 *      again;
 *   7. the API restarts on the same port: both clients reconnect by
 *      themselves, rejoin the new world, and see each other move again,
 *      their world clocks on the new world's ticks (which start over);
 *   8. each holds the new world's food, none of the old world's left.
 *
 * Then a party (godot-party.ts): a Node client hosts one, both games join it
 * by its code over the relay to the host, see each other move, hear a death
 * on partyEvents, and hear the host end it.
 *
 * Before the session, test/codec.gd decodes packed snapshots the TS
 * encoder made (codec-fixtures.ts: lost ones, seeds handled late, an index
 * a seed gives, a forgotten table) with snapshot_decoder.gd, and must get
 * what SnapshotDecoder gets for every one.
 *
 * Exit code 0 when every check held. QD_TRACE=1 also prints each client's
 * frames (the GDScript client's `trace`).
 */

// The bench env must be in place before any app module loads (the app's
// sign-in reads ENABLE_DEV_CREDENTIALS when it is built). Mirrors run.ts.
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "error";
process.env.ENABLE_DEV_CREDENTIALS = "true";
process.env.SERVICE_DEFAULT_ACCESS = "userService:Read";

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

type Scenario = import("@project/bench").Scenario;

const { startBenchServer, shutdownBenchDatabase } = await import("./server.js");
const { codecFixtures } = await import("./codec-fixtures.js");
const { GodotClient, PROJECT, sawMove, step } = await import("./godot-client.js");
const { checkParty } = await import("./godot-party.js");
type BenchServer = Awaited<ReturnType<typeof startBenchServer>>;
type GodotClient = InstanceType<typeof GodotClient>;
type Probe = import("./godot-client.js").Probe;

/** Two players and no NPCs in a small world: the snakes meet within seconds. */
const SESSION: Scenario = {
  name: "godot-session",
  description: "Two headless Godot clients in one world (the check:godot session)",
  seed: 11,
  durationMs: 0,
  warmupMs: 0,
  respawnDelayMs: 1_000,
  tunables: { npcCount: 0, worldWidth: 900, worldHeight: 900 },
  clients: [
    { name: "ada", behavior: { kind: "wander" } },
    { name: "bo", behavior: { kind: "wander" } },
    // the party's host, a Node client (godot-party.ts)
    { name: "cy", behavior: { kind: "spectator" } },
  ],
};

/**
 * True when `client`'s world clock renders just behind the newest snapshot
 * (the interpolation delay and the trip), not on another world's timeline:
 * after a restart the new world's ticks start over.
 */
function clockOnTime(client: GodotClient, from: number): boolean {
  const seen = client.since(from, "seen").at(-1);
  if (typeof seen?.tick !== "number" || typeof seen.renderTick !== "number") return false;
  const behind = seen.tick - seen.renderTick;
  return behind > 0 && behind < 10;
}

/** A food probe's ids, sorted, as one string. */
function idsOf(probe: Probe): string {
  return [...(probe.ids as string[])].sort().join(",");
}

/** True when a food probe holds the food the server held at the probe's tick. */
function foodMatches(probe: Probe, server: BenchServer): boolean {
  const truth = server.recorder.trace().food?.find((entry) => entry.tick === probe.tick);
  return truth !== undefined && idsOf(probe) === truth.ids.join(",");
}

/**
 * True when `client`'s latest food since probe `from` is the food the server
 * held at the same tick, and not its first since then: the client applied
 * the world's food changes, each tick's once, and kept no stale food.
 */
function heldServerFood(client: GodotClient, server: BenchServer, from: number): boolean {
  const probes = client.since(from, "food");
  const first = probes[0];
  const last = probes.at(-1);
  if (first === undefined || last === undefined) return false;
  return foodMatches(last, server) && idsOf(last) !== idsOf(first);
}

/** The two clients, and each with the other. */
interface Players {
  readonly ada: GodotClient;
  readonly bo: GodotClient;
  readonly both: readonly GodotClient[];
  readonly pairs: readonly (readonly [GodotClient, GodotClient])[];
}

async function checkJoinAndMove({ both, pairs }: Players): Promise<void> {
  await step("both join as their own users (hello, world stream, joinGame)", async () => {
    for (const client of both) {
      await client.waitFor("hello", 0, (p) => p.kind === "connected" && p.userId === client.userId);
      await client.waitFor("world bootstrap", 0, (p) => p.kind === "world");
    }
  });
  await step("each sees the other's snake move", async () => {
    for (const [client, other] of pairs) {
      await client.waitFor(`${other.name} moving`, 0, () => sawMove(client, other, 0));
      await client.waitFor("its world clock on time", 0, () => clockOnTime(client, 0));
    }
  });
}

async function checkDeathAndLeaderboard({ ada, bo, both }: Players): Promise<void> {
  await step("a death reaches both clients, and the dead player respawns", async () => {
    const death = await ada.waitFor("a death", 0, (p) => p.kind === "death");
    await bo.waitFor("the same death", 0, (p) => p.kind === "death" && p.id === death.id);
    const dead = both.find((client) => client.userId === death.id);
    if (dead === undefined) throw new Error(`a death of ${String(death.id)}, neither player`);
    const after = dead.probes.indexOf(death);
    await dead.waitFor("its respawned snake", after, (p) => p.kind === "seen" && p.me !== null);
  });
  await step("the leaderboard reaches both, naming both players", async () => {
    for (const client of both) {
      await client.waitFor("a leaderboard", 0, (p) => {
        const ids = p.ids as string[] | undefined;
        return (
          p.kind === "leaderboard" && ids?.includes(ada.userId) === true && ids.includes(bo.userId)
        );
      });
    }
  });
}

/** The server the clients talk to: the restart check replaces it. */
interface Running {
  server: BenchServer;
}

/** Each client's food against the server's, from probe `fromOf(client)` on. */
async function checkFood(
  label: string,
  { both }: Players,
  running: Running,
  fromOf: (client: GodotClient) => number,
): Promise<void> {
  await step(label, async () => {
    for (const client of both) {
      const from = fromOf(client);
      await client.waitFor("a match with the server's food", from, () =>
        heldServerFood(client, running.server, from),
      );
    }
  });
}

/**
 * ada's main scene heard no snapshot for a second (more than the food
 * window): past its blackout, it asked for a keyframe, and its food is the
 * server's at a tick after the blackout.
 */
async function checkFoodResync({ ada }: Players, running: Running): Promise<void> {
  await step(
    "a client that missed a second of snapshots asks for a keyframe, then holds the server's food",
    async () => {
      const end = await ada.waitFor(
        "the end of its blackout",
        0,
        (p) => p.kind === "blackout" && p.phase === "end",
      );
      const from = ada.probes.indexOf(end);
      const after = Number(end.tick);
      await ada.waitFor("a match with the server's food after a keyframe", from, () => {
        const last = ada.since(from, "food").at(-1);
        return (
          last !== undefined &&
          Number(last.resyncs) >= 1 &&
          Number(last.tick) > after &&
          foodMatches(last, running.server)
        );
      });
    },
  );
}

/**
 * bo's main scene heard every snapshot: it asked for no keyframe, neither
 * for food nor for a player its decoder could not name (ada's blackout was
 * main.gd's alone, so ada's decoder saw every snapshot too).
 */
async function checkNoResync({ bo }: Players): Promise<void> {
  await step("a client that missed no snapshot asks for no keyframe", () => {
    const last = bo.since(0, "food").at(-1);
    if (last === undefined) throw new Error("bo sent no food probe");
    if (Number(last.resyncs) !== 0) {
      throw new Error(`bo asked for ${String(last.resyncs)} keyframes, and missed nothing`);
    }
  });
}

/** Stops the server and starts a new one on its port. */
async function checkRestart({ both, pairs }: Players, running: Running): Promise<void> {
  await step("the API restarts: both reconnect, rejoin and see each other move", async () => {
    const marks = new Map(both.map((client) => [client, client.probes.length]));
    const mark = (client: GodotClient): number => marks.get(client) ?? 0;
    const { port } = running.server;
    await running.server.stop();
    for (const client of both) {
      await client.waitFor("the disconnect", mark(client), (p) => p.kind === "disconnected");
    }
    running.server = await startBenchServer(SESSION, { port });
    for (const client of both) {
      await client.waitFor("a new hello", mark(client), (p) => p.kind === "connected");
      await client.waitFor("a new bootstrap", mark(client), (p) => p.kind === "world");
      if (!running.server.game.sim.hasPlayer(client.userId)) {
        throw new Error(`${client.name} is not in the restarted world`);
      }
    }
    for (const [client, other] of pairs) {
      const from = mark(client);
      await client.waitFor(`${other.name} moving again`, from, () => sawMove(client, other, from));
      // within seconds: a clock left on the old world's timeline catches up
      // only when the new world's ticks pass it, many seconds later
      await client.waitFor(
        "its clock on the new world's time",
        from,
        () => clockOnTime(client, from),
        10_000,
      );
    }
  });
}

/**
 * snapshot_decoder.gd decodes the TS encoder's snapshots as SnapshotDecoder
 * does (test/codec.gd compares them): the bench's bots decode in wire order,
 * so only this runs the GDScript decoder's late seeds and forgotten tables.
 */
async function checkCodec(): Promise<void> {
  await step(
    "the GDScript decoder reads the TS encoder's snapshots as the TS decoder does",
    async () => {
      const fixtures = join(mkdtempSync(join(tmpdir(), "qd-codec-")), "codec.json");
      writeFileSync(fixtures, JSON.stringify(codecFixtures()));
      const child = spawn(
        process.env.GODOT ?? "godot",
        ["--headless", "--path", PROJECT, "--script", "res://test/codec.gd"],
        { env: { ...process.env, QD_CODEC_FIXTURES: fixtures }, stdio: ["ignore", "pipe", "pipe"] },
      );
      const lines: string[] = [];
      if (child.stdout)
        createInterface({ input: child.stdout }).on("line", (line) => lines.push(line));
      const code = await new Promise<number | null>((done) => {
        child.once("exit", done);
      });
      const codec = lines.filter((line) => line.startsWith("CODEC"));
      if (code !== 0 || !/^CODEC \d+ 0$/.test(codec.at(-1) ?? "")) {
        throw new Error(`test/codec.gd: ${codec.join("; ") || `exit ${String(code)}`}`);
      }
    },
  );
}

async function session(): Promise<void> {
  await checkCodec();
  const running: Running = { server: await startBenchServer(SESSION) };
  const url = `http://127.0.0.1:${String(running.server.port)}`;
  const userOf = (name: string): string => {
    const id = running.server.users.get(name);
    if (id === undefined) throw new Error(`no user ${name}`);
    return id;
  };
  console.log(`check:godot: server on ${url}; two headless games from ${PROJECT}`);
  const ada = new GodotClient("ada", userOf("ada"), url, { QD_FOOD_BLACKOUT: "1" });
  const bo = new GodotClient("bo", userOf("bo"), url);
  const players: Players = {
    ada,
    bo,
    both: [ada, bo],
    pairs: [
      [ada, bo],
      [bo, ada],
    ],
  };
  try {
    await checkJoinAndMove(players);
    await checkDeathAndLeaderboard(players);
    await checkFood(
      "each holds the server's food, each tick's change applied once",
      players,
      running,
      () => 0,
    );
    await checkFoodResync(players, running);
    await checkNoResync(players);
    await checkRestart(players, running);
    // the new world's ids repeat the old one's: its keyframe and its
    // bootstrap must replace them
    await checkFood(
      "each holds the new world's food, none of the old world's",
      players,
      running,
      (client) => client.probes.map((probe) => probe.kind).lastIndexOf("world"),
    );
  } finally {
    for (const client of players.both) client.stop();
  }
  try {
    const partyUrl = `http://127.0.0.1:${String(running.server.port)}`;
    await checkParty(partyUrl, { host: userOf("cy"), ada: userOf("ada"), bo: userOf("bo") });
  } finally {
    await running.server.stop();
  }
  const counts = players.both.map(
    (client) =>
      `${client.name}: ${String(client.since(0, "seen").length)} sightings, ${String(client.since(0, "death").length)} deaths, ${String(client.since(0, "leaderboard").length)} leaderboards, ${String(client.since(0, "connected").length)} hellos, ${String(client.since(0, "food").length)} food checks`,
  );
  console.log(`check:godot: every check held (${counts.join("; ")})`);
}

try {
  await session();
  process.exitCode = 0;
} catch (error) {
  console.error(`check:godot: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await shutdownBenchDatabase();
}
process.exit(process.exitCode);

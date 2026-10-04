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
 *   5. the API restarts on the same port: both clients reconnect by
 *      themselves, rejoin the new world, and see each other move again,
 *      their world clocks on the new world's ticks (which start over).
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

import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

type Scenario = import("@project/bench").Scenario;

const { startBenchServer, shutdownBenchDatabase } = await import("./server.js");
type BenchServer = Awaited<ReturnType<typeof startBenchServer>>;

const PROJECT = resolve(process.cwd(), "../game/godot");
const STEP_TIMEOUT_MS = 45_000;

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
  ],
};

interface Probe {
  readonly kind: string;
  readonly t: number;
  readonly [key: string]: unknown;
}

/** One headless game: its process and every PROBE line it printed. */
class GodotClient {
  public readonly probes: Probe[] = [];
  private readonly child: ChildProcess;
  private readonly waiters = new Set<() => void>();

  constructor(
    public readonly name: string,
    public readonly userId: string,
    url: string,
  ) {
    this.child = spawn(
      process.env.GODOT ?? "godot",
      ["--headless", "--path", PROJECT, "--script", "res://test/session.gd"],
      {
        env: {
          ...process.env,
          QUICKDRAW_DEV_USER_ID: userId,
          QUICKDRAW_API_URL: url,
          QUICKDRAW_TRACE: process.env.QD_TRACE ?? "",
          QD_SESSION_SECONDS: "180",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const onLine = (line: string): void => {
      if (line.startsWith("PROBE ")) {
        this.probes.push(JSON.parse(line.slice("PROBE ".length)) as Probe);
        for (const wake of this.waiters) wake();
      } else if (process.env.QD_TRACE === "1" || /error|warning/i.test(line)) {
        console.log(`  [${this.name}] ${line}`);
      }
    };
    if (this.child.stdout) createInterface({ input: this.child.stdout }).on("line", onLine);
    if (this.child.stderr) createInterface({ input: this.child.stderr }).on("line", onLine);
  }

  /** The probes of `kind` printed since probe number `from`. */
  public since(from: number, kind: string): Probe[] {
    return this.probes.slice(from).filter((probe) => probe.kind === kind);
  }

  /** Resolves with the first probe from number `from` on that matches, or rejects after `timeoutMs`. */
  public async waitFor(
    what: string,
    from: number,
    match: (probe: Probe) => boolean,
    timeoutMs = STEP_TIMEOUT_MS,
  ): Promise<Probe> {
    return await new Promise<Probe>((resolveProbe, reject) => {
      const check = (): boolean => {
        const found = this.probes.slice(from).find(match);
        if (found === undefined) return false;
        cleanup();
        resolveProbe(found);
        return true;
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`${this.name}: no ${what} within ${String(timeoutMs / 1000)} s`));
      }, timeoutMs);
      const cleanup = (): void => {
        clearTimeout(timer);
        this.waiters.delete(wake);
      };
      const wake = (): void => {
        check();
      };
      if (!check()) this.waiters.add(wake);
    });
  }

  public stop(): void {
    this.child.kill("SIGTERM");
  }
}

/**
 * True when `client` drew `other`'s snake at two different places since probe
 * `from`, two snapshots apart: what the player sees (the RemoteSnake,
 * interpolated on the world clock), not only what arrived.
 */
function sawMove(client: GodotClient, other: GodotClient, from: number): boolean {
  const places = new Set(
    client
      .since(from, "seen")
      .map((probe) => (probe.drawn as Record<string, number[]>)[other.userId])
      .filter((at): at is number[] => Array.isArray(at))
      .map((at) => at.join(",")),
  );
  return places.size >= 3;
}

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

async function step(label: string, check: () => Promise<unknown>): Promise<void> {
  const started = Date.now();
  await check();
  console.log(`  ✓ ${label} (${String(Date.now() - started)} ms)`);
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

async function session(): Promise<void> {
  const running: Running = { server: await startBenchServer(SESSION) };
  const url = `http://127.0.0.1:${String(running.server.port)}`;
  const userOf = (name: string): string => {
    const id = running.server.users.get(name);
    if (id === undefined) throw new Error(`no user ${name}`);
    return id;
  };
  console.log(`check:godot: server on ${url}; two headless games from ${PROJECT}`);
  const ada = new GodotClient("ada", userOf("ada"), url);
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
    await checkRestart(players, running);
  } finally {
    for (const client of players.both) client.stop();
    await running.server.stop();
  }
  const counts = players.both.map(
    (client) =>
      `${client.name}: ${String(client.since(0, "seen").length)} sightings, ${String(client.since(0, "death").length)} deaths, ${String(client.since(0, "leaderboard").length)} leaderboards, ${String(client.since(0, "connected").length)} hellos`,
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

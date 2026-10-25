/**
 * The two-browser check of the game client: `bun run check:web`.
 *
 * Boots the API's real services on the bench server (PGlite, the game loop
 * running, the sign-in routes for guests), the web app (apps/web, `next dev`
 * on a free port, pointed at that server), and two Playwright pages of
 * /game?probe=1, each playing as a guest through the real dialog and
 * steered to the world's centre by the page's probe
 * (apps/web/src/game/probe.ts, which records what the client sees), and
 * checks a whole session:
 *
 *   1. both play as their own users: the guest route, a hello naming the
 *      guest, the world's bootstrap, their own snake in the next snapshot;
 *   2. each sees the other's snake move: drawn where the world stream's
 *      snapshots, interpolated on the world clock, put it;
 *   3. a death reaches both (the snakes meet in the centre), and the dead
 *      player respawns (Respawn in the dialog);
 *   4. the leaderboard reaches both, naming both players;
 *   5. each holds the server's food: each tick's change applied once, from
 *      the window every snapshot repeats;
 *   6. ada's client hears no snapshot for a second (the probe's blackout,
 *      more than the window): it asks for a keyframe and holds the server's
 *      food again, and bo, who missed nothing, asked for none;
 *   7. the API restarts on the same port: both pages reconnect by
 *      themselves, rejoin the new world, and see each other move again,
 *      their world clocks on the new world's ticks (which start over);
 *   8. each holds the new world's food, none of the old world's left.
 *
 * Then a party (web-party.ts): a Node client hosts one, both pages join it
 * by its code through the dialog over the relay to the host, see each other
 * move, hear a death on partyEvents, and see the host end it.
 *
 * Exit code 0 when every check held and no page logged an error.
 * QD_HEADED=1 shows the browser; QD_TRACE=1 prints the web app's output.
 */

// The bench env must be in place before any app module loads (the app's
// sign-in reads ENABLE_DEV_CREDENTIALS when it is built). Mirrors run.ts.
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "error";
process.env.ENABLE_DEV_CREDENTIALS = "true";
process.env.SERVICE_DEFAULT_ACCESS = "userService:Read";
// The pages sign in as guests through the kit's routes, which sign their
// cookies with JWT_SECRET and refuse one under 32 characters (CI sets a short
// one for the test jobs, whose test app pins its own); a short or missing
// secret becomes the tests' pin
if ((process.env.JWT_SECRET ?? "").length < 32) {
  process.env.JWT_SECRET = "test-jwt-secret-of-at-least-32-characters";
}

import { spawn } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { chromium, type Browser } from "playwright";

type Scenario = import("@project/bench").Scenario;

/** A free TCP port of this machine. */
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      probe.close(() => {
        resolvePort(port);
      });
    });
  });
}

// The ports first: the bench server reads the web app's origin from the env
// when it boots (CORS, the guest cookie's origin rule, the socket handshake)
const webPort = await freePort();
const apiPort = await freePort();
const WEB_URL = `http://localhost:${String(webPort)}`;
const API_URL = `http://localhost:${String(apiPort)}`;
process.env.CLIENT_URL = WEB_URL;

const { startBenchServer, shutdownBenchDatabase } = await import("./server.js");
const { WebClient, sawMove, step } = await import("./web-client.js");
const { checkParty } = await import("./web-party.js");
type BenchServer = Awaited<ReturnType<typeof startBenchServer>>;
type WebClient = InstanceType<typeof WebClient>;
type Probe = import("./web-client.js").Probe;

/** Two players and no NPCs in a small world: the snakes meet within seconds. */
const SESSION: Scenario = {
  name: "web-session",
  description: "Two browser pages of the game client in one world (the check:web session)",
  seed: 11,
  durationMs: 0,
  warmupMs: 0,
  respawnDelayMs: 1_000,
  tunables: { npcCount: 0, worldWidth: 900, worldHeight: 900 },
  // the party's host, a Node client (web-party.ts); the two players are
  // guests of the web app, signed in through its route
  clients: [{ name: "cy", behavior: { kind: "spectator" } }],
};
const CENTRE = { x: 450, y: 450 };
/** A second without snapshots: 20 ticks, more than the food window, so the client must ask for a keyframe. */
const BLACKOUT_MS = 1_000;
/** How long the web app may take to answer /game (its first compile). */
const WEB_BOOT_MS = 180_000;

interface WebApp {
  stop(): void;
}

/**
 * The web app from apps/web: `next dev` on the check's port, with a dist
 * dir of its own (Next refuses a second dev server on a project's .next)
 * and pointed at the bench server; resolves once /game answers.
 */
async function startWebApp(): Promise<WebApp> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(webPort),
    NEXT_PUBLIC_API_URL: API_URL,
    NEXT_DIST_DIR: ".next-check",
    BROWSER: "none",
  };
  // next dev is development, whatever this process is
  delete env.NODE_ENV;
  const child = spawn("bun", ["run", "dev"], {
    cwd: resolve(process.cwd(), "../web"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const onLine = (line: string): void => {
    // Next marks its own failures with ⨯; the rest is the dev server's chatter
    if (process.env.QD_TRACE === "1" || line.includes("⨯")) console.log(`  [web] ${line}`);
  };
  if (child.stdout) createInterface({ input: child.stdout }).on("line", onLine);
  if (child.stderr) createInterface({ input: child.stderr }).on("line", onLine);
  const stop = (): void => {
    if (child.pid === undefined) return;
    try {
      // the whole group: bun, next and its workers
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // gone already
    }
  };
  const deadline = Date.now() + WEB_BOOT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`the web app exited with ${String(child.exitCode)}`);
    }
    try {
      const response = await fetch(`${WEB_URL}/game`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return { stop };
    } catch {
      // not up yet
    }
    await new Promise<void>((resolveWait) => {
      setTimeout(resolveWait, 1_000);
    });
  }
  stop();
  throw new Error(`the web app did not answer ${WEB_URL}/game in time`);
}

/**
 * True when `client`'s world clock renders just behind the newest snapshot
 * (the interpolation delay and the trip), not on another world's timeline:
 * after a restart the new world's ticks start over. The pages run the
 * default `RemotesMode` (playback); at the present the render tick is the
 * estimate, at or past the newest tick, and this check would say no.
 */
function clockOnTime(client: WebClient, from: number): boolean {
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
function heldServerFood(client: WebClient, server: BenchServer, from: number): boolean {
  const probes = client.since(from, "food");
  const first = probes[0];
  const last = probes.at(-1);
  if (first === undefined || last === undefined) return false;
  return foodMatches(last, server) && idsOf(last) !== idsOf(first);
}

/** What a page recorded last, for a failed step: its counts, and its newest entries of the kinds that explain most. */
function dump(client: WebClient): void {
  const kinds = ["connected", "disconnected", "world", "joined", "blackout", "death", "food"];
  const counts = kinds.map((kind) => `${kind} ${String(client.since(0, kind).length)}`).join(", ");
  console.error(
    `  ${client.name}: ${String(client.probes.length)} probes (${counts}); user ${client.userId}`,
  );
  for (const probe of client.probes.filter((p) => p.kind !== "seen").slice(-8)) {
    const { ids, ...rest } = probe;
    const food = Array.isArray(ids) ? ` ids×${String(ids.length)}` : "";
    console.error(`    ${JSON.stringify(rest)}${food}`);
  }
  for (const error of client.errors) console.error(`    page error: ${error}`);
}

/** The two pages, and each with the other. */
interface Players {
  readonly ada: WebClient;
  readonly bo: WebClient;
  readonly both: readonly WebClient[];
  readonly pairs: readonly (readonly [WebClient, WebClient])[];
}

/** The server the pages talk to: the restart check replaces it. */
interface Running {
  server: BenchServer;
}

const ownSnake = (probe: Probe): boolean => probe.kind === "seen" && probe.me !== null;

async function checkJoinAndMove({ both, pairs }: Players): Promise<void> {
  await step(
    "both play as their own users (the guest route, a hello, the world, their own snake)",
    async () => {
      for (const client of both) {
        await client.steer(CENTRE.x, CENTRE.y);
        const hello = await client.playAsGuest();
        // the client starts over as the guest: its world, then its snake
        await client.waitFor("the guest's world", hello, (p) => p.kind === "world");
        await client.waitFor("its own snake", hello, ownSnake);
      }
    },
  );
  await step("each sees the other's snake move", async () => {
    for (const [client, other] of pairs) {
      await client.waitFor(`${other.name} moving`, 0, () => sawMove(client, other, 0));
      await client.waitFor("its world clock on time", 0, () => clockOnTime(client, 0));
    }
  });
}

async function checkDeathAndLeaderboard({ ada, bo, both }: Players): Promise<void> {
  await step("a death reaches both pages, and the dead player respawns", async () => {
    const death = await ada.waitFor("a death", 0, (p) => p.kind === "death");
    await bo.waitFor("the same death", 0, (p) => p.kind === "death" && p.id === death.id);
    const dead = both.find((client) => client.userId === death.id);
    if (dead === undefined) throw new Error(`a death of ${String(death.id)}, neither player`);
    // the dead page's own probe of that death (both hear every death, in
    // order): its respawned snake comes after it
    const after = dead.probes.findIndex((p) => p.kind === "death" && p.id === death.id);
    await dead.waitFor("its respawned snake", after, ownSnake);
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

/** Each page's food against the server's, from probe `fromOf(client)` on. */
async function checkFood(
  label: string,
  { both }: Players,
  running: Running,
  fromOf: (client: WebClient) => number,
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
 * ada's client hears no snapshot for a second (more than the food window):
 * past its blackout, it asked for a keyframe, and its food is the server's
 * at a tick after the blackout.
 */
async function checkFoodResync({ ada }: Players, running: Running): Promise<void> {
  await step(
    "a page that missed a second of snapshots asks for a keyframe, then holds the server's food",
    async () => {
      const mark = ada.probes.length;
      await ada.blackout(BLACKOUT_MS);
      const end = await ada.waitFor(
        "the end of its blackout",
        mark,
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

/** bo's client heard every snapshot: it asked for no keyframe. */
async function checkNoResync({ bo }: Players): Promise<void> {
  await step("a page that missed no snapshot asks for no keyframe", () => {
    const last = bo.since(0, "food").at(-1);
    if (last === undefined) throw new Error("bo recorded no food probe");
    if (Number(last.resyncs) !== 0) {
      throw new Error(`bo asked for ${String(last.resyncs)} keyframes, and missed nothing`);
    }
  });
}

/** Resolves once `test` holds, or rejects after `timeoutMs`. */
async function until(what: string, test: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!test()) {
    if (Date.now() > deadline) throw new Error(`no ${what} within ${String(timeoutMs / 1000)} s`);
    await new Promise<void>((resolveWait) => {
      setTimeout(resolveWait, 100);
    });
  }
}

/** Stops the server and starts a new one on its port. */
async function checkRestart({ both, pairs }: Players, running: Running): Promise<void> {
  await step("the API restarts: both reconnect, rejoin and see each other move", async () => {
    const marks = new Map(both.map((client) => [client, client.probes.length]));
    const mark = (client: WebClient): number => marks.get(client) ?? 0;
    const { port } = running.server;
    await running.server.stop();
    for (const client of both) {
      await client.waitFor("the disconnect", mark(client), (p) => p.kind === "disconnected");
    }
    running.server = await startBenchServer(SESSION, { port, routes: true });
    for (const client of both) {
      await client.waitFor("a new hello", mark(client), (p) => p.kind === "connected");
      await client.waitFor("a new bootstrap", mark(client), (p) => p.kind === "world");
      // the page's joinGame runs again on the new connection
      await until(
        `${client.name} in the restarted world`,
        () => running.server.game.sim.hasPlayer(client.userId),
        10_000,
      );
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

/** The checks, in order, on two pages that opened the game. */
async function checkSession(players: Players, running: Running, hostUserId: string): Promise<void> {
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
  await checkParty(API_URL, { both: players.both, pairs: players.pairs }, hostUserId);
  for (const client of players.both) {
    if (client.errors.length > 0) {
      throw new Error(`${client.name}'s page logged errors:\n  ${client.errors.join("\n  ")}`);
    }
  }
}

function countsOf(players: Players): string {
  return players.both
    .map(
      (client) =>
        `${client.name}: ${String(client.since(0, "seen").length)} sightings, ${String(client.since(0, "death").length)} deaths, ${String(client.since(0, "leaderboard").length)} leaderboards, ${String(client.since(0, "connected").length)} hellos, ${String(client.since(0, "food").length)} food checks`,
    )
    .join("; ");
}

/** Two pages of the game, their browser and their web app, released whatever happens. */
async function withPages(run: (players: Players) => Promise<void>): Promise<Players> {
  const web = await startWebApp();
  // an interrupt must not leave the web app's process group behind
  const interrupted = (): void => {
    web.stop();
    process.exit(130);
  };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  let browser: Browser | null = null;
  let players: Players | null = null;
  try {
    browser = await chromium.launch({ headless: process.env.QD_HEADED !== "1" });
    console.log(`check:web: server on ${API_URL}, web app on ${WEB_URL}; two pages of /game`);
    const ada = new WebClient("ada", browser, WEB_URL);
    const bo = new WebClient("bo", browser, WEB_URL);
    players = {
      ada,
      bo,
      both: [ada, bo],
      pairs: [
        [ada, bo],
        [bo, ada],
      ],
    };
    for (const client of players.both) await client.open();
    try {
      await run(players);
    } catch (error) {
      for (const client of players.both) dump(client);
      throw error;
    }
    return players;
  } finally {
    for (const client of players?.both ?? []) await client.stop();
    await browser?.close();
    web.stop();
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", interrupted);
  }
}

async function session(): Promise<void> {
  const running: Running = {
    server: await startBenchServer(SESSION, { port: apiPort, routes: true }),
  };
  const userOf = (name: string): string => {
    const id = running.server.users.get(name);
    if (id === undefined) throw new Error(`no user ${name}`);
    return id;
  };
  try {
    const players = await withPages((pages) => checkSession(pages, running, userOf("cy")));
    console.log(`check:web: every check held (${countsOf(players)})`);
  } finally {
    await running.server.stop();
  }
}

try {
  await session();
  process.exitCode = 0;
} catch (error) {
  console.error(`check:web: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await shutdownBenchDatabase();
}
process.exit(process.exitCode);

/**
 * One headless copy of the real game (apps/game/godot, main scene and
 * autoloads, through test/session.gd), and what `check:godot` reads of it:
 * every PROBE line it printed. The world session (godot-session.ts) and the
 * party session (godot-party.ts) drive two of them each.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

export const PROJECT = resolve(process.cwd(), "../game/godot");
export const STEP_TIMEOUT_MS = 45_000;

export interface Probe {
  readonly kind: string;
  readonly t: number;
  readonly [key: string]: unknown;
}

/** One headless game: its process and every PROBE line it printed. */
export class GodotClient {
  public readonly probes: Probe[] = [];
  private readonly child: ChildProcess;
  private readonly waiters = new Set<() => void>();

  constructor(
    public readonly name: string,
    public readonly userId: string,
    url: string,
    env: Record<string, string> = {},
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
          ...env,
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
export function sawMove(client: GodotClient, other: GodotClient, from: number): boolean {
  const places = new Set(
    client
      .since(from, "seen")
      .map((probe) => (probe.drawn as Record<string, number[]>)[other.userId])
      .filter((at): at is number[] => Array.isArray(at))
      .map((at) => at.join(",")),
  );
  return places.size >= 3;
}

export async function step(label: string, check: () => unknown): Promise<void> {
  const started = Date.now();
  await check();
  console.log(`  ✓ ${label} (${String(Date.now() - started)} ms)`);
}

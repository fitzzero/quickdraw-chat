/**
 * One browser page of the game (the web client at /game?probe=1), driven
 * over Playwright, and what `check:web` reads of it: every entry its probe
 * recorded (apps/web/src/game/probe.ts), drained every 200 ms. The world
 * session (web-session.ts) and the party session (web-party.ts) drive two
 * each. A page plays as a guest through the real dialog, and clicks
 * Respawn a second after its own death, as the headless check's session
 * script respawned.
 */

import type { Browser, BrowserContext, Page } from "playwright";

export const STEP_TIMEOUT_MS = 45_000;
/** How long after its death a page clicks Respawn. */
const RESPAWN_AFTER_MS = 1_000;
const DRAIN_EVERY_MS = 200;
/** Chromium's network log reaches the console as errors: a socket's retry while the API restarts is one. */
const NETWORK_LOG = /^(Failed to load resource|WebSocket connection to )/;
/**
 * Chromium's log of a send on a WebSocket that is already closing: Socket.IO
 * writes to its socket until the close event, so an input frame or a pong
 * in the moment after the server closed it (the API restart) lands there.
 * That is the race, not the page's error, only when the page recorded the
 * disconnect within CLOSING_SEND_MS of it; any other is the page's error (a
 * socket it kept writing to after it closed).
 */
const CLOSING_SEND = "WebSocket is already in CLOSING or CLOSED state.";
const CLOSING_SEND_MS = 2_000;

export interface Probe {
  readonly kind: string;
  readonly t: number;
  readonly [key: string]: unknown;
}

/** The page's probe sink (apps/web/src/game/probe.ts), as the functions evaluated in the page see it. */
declare const window: {
  QuickdrawProbe?: {
    drain(): Probe[];
    steer(x: number, y: number): void;
    blackout(ms: number): void;
  };
};

/** One page of the game: its browser context and every entry its probe recorded. */
export class WebClient {
  public readonly probes: Probe[] = [];
  /** The page's console errors and uncaught exceptions, when each came (epoch ms) and where from. */
  private readonly logged: { t: number; text: string; at: string }[] = [];
  /** The user the page signed in as (a guest): the first hello that named one. */
  public userId = "";
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly waiters = new Set<() => void>();
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    public readonly name: string,
    private readonly browser: Browser,
    private readonly webUrl: string,
  ) {}

  /** Opens the game page (the pre-game dialog, spectating). */
  public async open(): Promise<void> {
    this.context = await this.browser.newContext({ viewport: { width: 1280, height: 720 } });
    this.page = await this.context.newPage();
    this.page.on("console", (message) => {
      // the page's own errors, not the browser's network log
      if (message.type() === "error" && !NETWORK_LOG.test(message.text())) {
        const { url, lineNumber } = message.location();
        this.logged.push({
          t: Date.now(),
          text: message.text().slice(0, 300),
          at: url === "" ? "" : ` (${url}:${String(lineNumber)})`,
        });
      }
    });
    this.page.on("pageerror", (error) =>
      this.logged.push({
        t: Date.now(),
        text: `pageerror: ${String(error).slice(0, 300)}`,
        at: "",
      }),
    );
    await this.goToGame();
    this.timer = setInterval(() => void this.drain(), DRAIN_EVERY_MS);
  }

  /**
   * The page's console errors and uncaught exceptions, each with where it
   * came from: a session with any fails. A send that raced the server's
   * close of the page's socket is left out (CLOSING_SEND).
   */
  public get errors(): string[] {
    const disconnects = this.probes.filter((p) => p.kind === "disconnected").map((p) => p.t);
    return this.logged
      .filter(
        ({ t, text }) =>
          text !== CLOSING_SEND || !disconnects.some((at) => Math.abs(at - t) <= CLOSING_SEND_MS),
      )
      .map(({ text, at }) => `${text}${at}`);
  }

  /** The game page (again: the dialog back, the session kept); its probe starts over with the page. */
  public async goToGame(): Promise<void> {
    await this.current().goto(`${this.webUrl}/game?probe=1`, { waitUntil: "domcontentloaded" });
    await this.current().waitForSelector("#game-canvas", { timeout: STEP_TIMEOUT_MS });
  }

  /**
   * Plays as a guest named after the client: the real sign-in route, then
   * the page's own start. Resolves with the number of the hello that named
   * the guest: what follows (the guest's world, its snake) comes after it.
   */
  public async playAsGuest(): Promise<number> {
    const name = this.current().getByPlaceholder(/snake name/i);
    await name.waitFor({ timeout: STEP_TIMEOUT_MS });
    await name.fill(this.name);
    await this.click(/play as guest/i);
    const hello = await this.waitFor(
      "a hello naming the guest",
      0,
      (p) => p.kind === "connected" && typeof p.userId === "string",
    );
    this.userId = hello.userId as string;
    return this.probes.indexOf(hello);
  }

  public async click(name: RegExp): Promise<void> {
    await this.current().getByRole("button", { name }).click({ timeout: STEP_TIMEOUT_MS });
  }

  public async fill(placeholder: RegExp, value: string): Promise<void> {
    await this.current().getByPlaceholder(placeholder).fill(value, { timeout: STEP_TIMEOUT_MS });
  }

  /** Resolves once the page shows `text`. */
  public async waitForText(text: RegExp): Promise<void> {
    await this.current().getByText(text).first().waitFor({ timeout: STEP_TIMEOUT_MS });
  }

  /** Steers the local snake toward a world point (the probe's control, kept across the page's clients). */
  public async steer(x: number, y: number): Promise<void> {
    await this.current().evaluate(([px, py]) => window.QuickdrawProbe?.steer(px, py), [x, y]);
  }

  /** The client hears no snapshot for `ms`, as if the stream dropped them. */
  public async blackout(ms: number): Promise<void> {
    await this.current().evaluate((m) => window.QuickdrawProbe?.blackout(m), ms);
  }

  /** The probes of `kind` recorded since probe number `from`. */
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

  public async stop(): Promise<void> {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    await this.context?.close().catch(() => undefined);
    this.context = null;
    this.page = null;
  }

  private current(): Page {
    if (this.page === null) throw new Error(`${this.name}: the page is closed`);
    return this.page;
  }

  /** The probe's new entries; a death of this page's user schedules its Respawn. */
  private async drain(): Promise<void> {
    if (this.draining || this.page === null) return;
    this.draining = true;
    let entries: Probe[] = [];
    try {
      entries = await this.page.evaluate(() => window.QuickdrawProbe?.drain() ?? []);
    } catch {
      // a navigation in flight: the next drain reads the new page
      entries = [];
    } finally {
      this.draining = false;
    }
    if (entries.length === 0) return;
    for (const entry of entries) {
      this.probes.push(entry);
      if (entry.kind === "death" && entry.id === this.userId) this.respawnLater();
    }
    for (const wake of this.waiters) wake();
  }

  private respawnLater(): void {
    setTimeout(() => {
      this.page
        ?.getByRole("button", { name: /respawn|try again/i })
        .click({ timeout: 5_000 })
        .catch(() => undefined);
    }, RESPAWN_AFTER_MS);
  }
}

/**
 * True when `client` drew `other`'s snake at three different places since
 * probe `from`: what the player sees (the remote interpolated on the world
 * clock), not only what arrived.
 */
export function sawMove(client: WebClient, other: WebClient, from: number): boolean {
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

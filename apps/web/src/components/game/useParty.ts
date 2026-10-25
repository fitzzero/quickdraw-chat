"use client";

/**
 * The page's party, if any (host mode): hosting one (hostParty: this page's
 * socket becomes its host, and usePartyHost runs its world), joining one by
 * its code (joinParty, joined again on every connection with `useJoin`),
 * leaving or ending it, and what the page reads of it: the party's events
 * from its host (the page's own death, the leaderboard) and the server's
 * word that it ended (partyClosed, hostLeft). The game itself plays in
 * the page's game client, which takes the party's feeds through PartyWire
 * on this same socket (one socket per user).
 *
 * The page's socket outlives the page (the provider is the app's): a page
 * that stops showing its party (another page of the app) ends it as its
 * host, or leaves it, so no party is left with a host that serves nothing.
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { QuickdrawError } from "@fitzzero/quickdraw-core";
import { useJoin, useQuickdraw } from "@fitzzero/quickdraw-core/client";
import type { GameDeathEvent, PartyEvent, PartyLeaderboard } from "@project/shared";
import { qd } from "../../lib/quickdraw";
import { useErrorText } from "../../hooks/useErrorText";
import { useNewItems } from "../../hooks/useNewItems";
import { usePartyHost } from "./partyHost";

/** The party the page is in. */
export interface PartyState {
  readonly worldId: string;
  readonly code: string;
  readonly chatId: string | null;
  /** "host": this page runs the party's world; "guest": it joined one by its code. */
  readonly role: "host" | "guest";
}

/**
 * Why the page's last party ended without its leaving: its host closed it,
 * its host left, or it ended while the page was away (a reconnect's join).
 */
export type PartyEnd = "closed" | "hostLeft" | "ended";

export interface PartySession {
  readonly party: PartyState | null;
  /** Hosting or joining in flight. */
  readonly busy: boolean;
  /** Why the last host or join failed, for people. */
  readonly error: string | undefined;
  /** Why the last party ended, until the next one starts. */
  readonly ended: PartyEnd | null;
  /** The party's latest leaderboard, from its host (each player's round trip, the fair link). */
  readonly leaderboard: PartyLeaderboard | null;
  /** The party's feeds may subscribe: a guest's at once, a host's once its page serves the party. */
  readonly serving: boolean;
  host(): void;
  join(code: string): void;
  /** Leaves the party; its host ends it. */
  leave(): void;
}

/**
 * How long a page that stopped showing its party waits before it ends or
 * leaves it: a remount in development (StrictMode, a hot reload) shows the
 * party again first, which calls the end off.
 */
const END_AFTER_UNMOUNT_MS = 500;

/** The ends pages scheduled when they stopped showing their party, by world. */
const pendingEnds = new Map<string, number>();

/** Ends a party as its host, or leaves it, through the provider's connection. */
function endOrLeave(party: PartyState): Promise<unknown> {
  const input = { worldId: party.worldId };
  return party.role === "host"
    ? qd.gameService.closeParty.call(input)
    : qd.gameService.leaveParty.call(input);
}

/** Ends or leaves the page's party once the page stops showing it, unless it shows it again first. */
function useEndOnUnmount(party: PartyState | null): void {
  const shown = React.useRef(party);
  React.useEffect(() => {
    shown.current = party;
    if (party === null) return;
    const pending = pendingEnds.get(party.worldId);
    if (pending !== undefined) window.clearTimeout(pending);
    pendingEnds.delete(party.worldId);
  }, [party]);
  React.useEffect(
    () => () => {
      const last = shown.current;
      if (last === null) return;
      const end = (): void => {
        pendingEnds.delete(last.worldId);
        endOrLeave(last).catch(() => undefined);
      };
      pendingEnds.set(last.worldId, window.setTimeout(end, END_AFTER_UNMOUNT_MS));
    },
    [],
  );
}

/** The newest leaderboard among a party's events. */
function latestBoard(items: readonly PartyEvent[]): PartyLeaderboard | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item?.kind === "leaderboard") return item;
  }
  return null;
}

// oxlint-disable-next-line max-lines-per-function -- one party's lifecycle
export function useParty(options: {
  /** The page's own snake died in the party. */
  onDeath: (death: GameDeathEvent) => void;
  /** The host lags its own user's links to its players' median (`?fairLink=off` turns it off). */
  fairLink: boolean;
}): PartySession {
  const t = useTranslations("GameDialog");
  const errorText = useErrorText();
  const { userId } = useQuickdraw();
  const [party, setParty] = React.useState<PartyState | null>(null);
  const [joinCode, setJoinCode] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [ended, setEnded] = React.useState<PartyEnd | null>(null);

  const hostParty = qd.gameService.hostParty.useMutation();
  /** The party the page is ending or leaving itself: its end is no news. */
  const leaving = React.useRef<string | null>(null);
  /** The party whose end the page already shows: a later word of its end is no news. */
  const endedWorld = React.useRef<string | null>(null);
  useEndOnUnmount(party);

  // A guest's socket in the party's room on every connection (a new socket
  // is in no room until a call joins it)
  const joining = useJoin(
    qd.gameService.joinParty,
    { code: joinCode ?? "" },
    {
      enabled: joinCode !== null,
      onJoined: (joined) => {
        setParty({
          worldId: joined.worldId,
          code: joined.code,
          chatId: joined.chatId,
          role: "guest",
        });
      },
    },
  );
  const joinError = joining.status === "error" ? joining.error : null;
  /** The refused join handled last: a new join starts with it still reported for a render. */
  const handledJoinError = React.useRef<QuickdrawError | null>(null);
  React.useEffect(() => {
    if (joinError === null || joinError === handledJoinError.current) return;
    handledJoinError.current = joinError;
    // a refused join stands: the code was wrong, or the party ended
    setJoinCode(null);
    setParty(null);
    // a party the page was in, which a reconnect's join no longer finds
    if (party !== null && joinError.code === "NOT_FOUND") setEnded("ended");
    else setError(joinError.code === "NOT_FOUND" ? t("partyNotFound") : errorText(joinError));
  }, [joinError, party, errorText, t]);

  const finish = (end: PartyEnd | null): void => {
    setParty(null);
    setJoinCode(null);
    setEnded(end);
  };
  /** The party ended, unless the page is ending or leaving it itself. */
  const endedBy = (worldId: string, end: PartyEnd): void => {
    if (worldId !== party?.worldId || leaving.current === worldId) return;
    if (endedWorld.current === worldId) return;
    endedWorld.current = worldId;
    finish(end);
  };
  qd.gameService.partyClosed.useEvent((closed) => endedBy(closed.worldId, "closed"));
  qd.gameService.hostLeft.useEvent((left) => endedBy(left.worldId, "hostLeft"));

  // the host's page no longer hosts once its socket is gone: the server
  // ended the party (hostLeft), which a new socket does not hear
  const hosting = usePartyHost(
    party?.role === "host" ? party.worldId : null,
    options.fairLink,
    () => {
      if (party !== null) endedBy(party.worldId, "hostLeft");
    },
  );
  // quickdraw-5.0 finding: the host's own feed of a room it hosts reaches it
  // over an in-process link, but one subscribed before `serve` (core 5.1.3)
  // never gets its seed or items: the host's page subscribes once it serves
  const events = qd.gameService.partyEvents.useStream(party?.worldId ?? null, {
    max: 200,
    enabled: party?.role !== "host" || hosting.serving,
  });
  // a list a new seed replaced holds no news: the deaths in it were heard
  useNewItems(
    events.items,
    (event) => {
      if (event.kind === "death" && event.id === userId) options.onDeath(event);
    },
    { replaced: "skip" },
  );

  return {
    party,
    busy: hostParty.isPending || joining.status === "joining",
    error,
    ended,
    leaderboard: latestBoard(events.items),
    serving: party?.role !== "host" || hosting.serving,
    host: () => {
      leaving.current = null;
      endedWorld.current = null;
      setError(undefined);
      setEnded(null);
      hostParty.mutateAsync({}).then(
        (hosted) => setParty({ ...hosted, role: "host" }),
        (failure: unknown) => setError(errorText(failure)),
      );
    },
    join: (code) => {
      leaving.current = null;
      endedWorld.current = null;
      setError(undefined);
      setEnded(null);
      setJoinCode(code);
    },
    // the page shows the party until the server ended it (or the user left
    // it), and says why when it could not
    leave: () => {
      const current = party;
      if (current === null) return;
      leaving.current = current.worldId;
      setError(undefined);
      endOrLeave(current).then(
        () => finish(null),
        (failure: unknown) => {
          // a party that ended already has nothing left to end
          if (failure instanceof QuickdrawError && failure.code === "NOT_FOUND") {
            finish(null);
            return;
          }
          leaving.current = null;
          setError(errorText(failure));
        },
      );
    },
  };
}

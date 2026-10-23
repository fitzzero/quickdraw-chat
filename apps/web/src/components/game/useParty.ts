"use client";

/**
 * The page's party, if any (host mode): hosting one (hostParty: this page's
 * socket becomes its host, and usePartyHost runs its world), joining one by
 * its code (joinParty, joined again on every connection with `useJoin`),
 * leaving or ending it, and what the page reads of it: the party's events
 * from its host (the page's own death, the leaderboard) and the server's
 * word that it ended (partyClosed, hostLeft). The game itself plays in
 * Godot, which joins the party on its own socket (QuickdrawHost.party).
 */

import * as React from "react";
import { useTranslations } from "next-intl";
import { useJoin, useQuickdraw } from "@fitzzero/quickdraw-core/client";
import type { GameDeathEvent, PartyEvent, PartyLeaderboard } from "@project/shared";
import { qd } from "../../lib/quickdraw";
import { useErrorText } from "../../hooks/useErrorText";
import { usePartyHost, type PartyLinks } from "./partyHost";

/** The party the page is in. */
export interface PartyState {
  readonly worldId: string;
  readonly code: string;
  readonly chatId: string | null;
  /** "host": this page runs the party's world; "guest": it joined one by its code. */
  readonly role: "host" | "guest";
}

/** Why the page's last party ended without its leaving. */
export type PartyEnd = "closed" | "hostLeft";

export interface PartySession {
  readonly party: PartyState | null;
  /** Hosting or joining in flight. */
  readonly busy: boolean;
  /** Why the last host or join failed, for people. */
  readonly error: string | undefined;
  /** Why the last party ended, until the next one starts. */
  readonly ended: PartyEnd | null;
  /** The party's latest leaderboard, from its host. */
  readonly leaderboard: PartyLeaderboard | null;
  /** What the host's links measure: on the host's page only. */
  readonly links: PartyLinks | null;
  host(): void;
  join(code: string): void;
  /** Leaves the party; its host ends it. */
  leave(): void;
}

/**
 * Calls `onItem` once for each item a stream appended since the last call.
 * A list that no longer holds the last item handled was replaced by a new
 * seed (a new link to the host), which holds no news: it is skipped.
 */
function useNewItems<T>(items: readonly T[], onItem: (item: T) => void): void {
  const last = React.useRef<T | undefined>(undefined);
  const handle = React.useRef(onItem);
  React.useEffect(() => {
    handle.current = onItem;
  });
  React.useEffect(() => {
    const previous = last.current;
    const at = previous === undefined ? -1 : items.lastIndexOf(previous);
    const fresh = previous === undefined || at >= 0 ? items.slice(at + 1) : [];
    last.current = items.at(-1);
    for (const item of fresh) handle.current(item);
  }, [items]);
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
  const leaveParty = qd.gameService.leaveParty.useMutation();
  const closeParty = qd.gameService.closeParty.useMutation();

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
  React.useEffect(() => {
    // a refused join stands: the code was wrong, or the party ended
    if (joinError !== null) {
      setError(joinError.code === "NOT_FOUND" ? t("partyNotFound") : errorText(joinError));
      setJoinCode(null);
      setParty(null);
    }
  }, [joinError, errorText, t]);

  const finish = (end: PartyEnd | null): void => {
    setParty(null);
    setJoinCode(null);
    setEnded(end);
  };
  qd.gameService.partyClosed.useEvent((closed) => {
    if (closed.worldId === party?.worldId) finish("closed");
  });
  qd.gameService.hostLeft.useEvent((left) => {
    if (left.worldId === party?.worldId) finish("hostLeft");
  });

  const events = qd.gameService.partyEvents.useStream(party?.worldId ?? null, { max: 200 });
  useNewItems(events.items, (event) => {
    if (event.kind === "death" && event.id === userId) options.onDeath(event);
  });

  const links = usePartyHost(party?.role === "host" ? party.worldId : null, options.fairLink);

  return {
    party,
    busy: hostParty.isPending || joining.status === "joining",
    error,
    ended,
    leaderboard: latestBoard(events.items),
    links,
    host: () => {
      setError(undefined);
      setEnded(null);
      hostParty.mutateAsync({}).then(
        (hosted) => setParty({ ...hosted, role: "host" }),
        (failure: unknown) => setError(errorText(failure)),
      );
    },
    join: (code) => {
      setError(undefined);
      setEnded(null);
      setJoinCode(code);
    },
    leave: () => {
      const current = party;
      finish(null);
      if (current === null) return;
      const input = { worldId: current.worldId };
      if (current.role === "host") closeParty.mutate(input);
      else leaveParty.mutate(input);
    },
  };
}

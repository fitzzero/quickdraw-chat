/**
 * A party's host in Node (host mode), as the web page is in a browser
 * (apps/web/src/components/game/partyHost.ts): a client of the typed
 * client's core (no React) that signs in with development credentials,
 * hosts a party (hostParty), runs its world (PartyWorld, the loop on its own
 * timers) and serves it to the party's players with defineHost, over the
 * server's relay (Node has no WebRTC). check:godot's party session hosts
 * with it; quickdraw's examples/godot/test/host.ts (core-v5.1.3) is the
 * pattern.
 */

import {
  callData,
  createQuickdrawConnection,
  defineHost,
  type Host,
  type QuickdrawConnection,
} from "@fitzzero/quickdraw-core/client/core";
import {
  PartyWorld,
  gameContract,
  partyRoom,
  type GameTunables,
  type PartyHosted,
} from "@project/shared";

export interface NodePartyHost {
  readonly party: PartyHosted;
  readonly world: PartyWorld;
  /** Ends the party (closeParty): its room hears partyClosed. */
  close(): Promise<void>;
  /** Stops the world and disconnects (the party ends: its room hears hostLeft). */
  stop(): void;
}

/** Resolves once the server said hello to the connection. */
async function hello(connection: QuickdrawConnection): Promise<void> {
  await new Promise<void>((resolve) => {
    const off = connection.onHello(() => {
      off();
      resolve();
    });
  });
}

/** Connects as `userId`, hosts a party, and serves its world on `tunables` (over PARTY_TUNABLES). */
export async function hostNodeParty(
  url: string,
  userId: string,
  tunables: Partial<GameTunables> = {},
): Promise<NodePartyHost> {
  const connection = createQuickdrawConnection({
    url,
    auth: { userId },
    transports: ["websocket"],
  });
  connection.open();
  await hello(connection);
  const party = await callData<PartyHosted>(connection, {
    service: "gameService",
    method: "hostParty",
    input: {},
    kind: "mutation",
  });

  const room = partyRoom(party.worldId);
  let host: Host<typeof gameContract> | undefined;
  const world = new PartyWorld({
    tunables,
    emit: {
      world: (snapshot) => host?.stream("partyWorld").push(party.worldId, snapshot),
      event: (event) => host?.stream("partyEvents").push(party.worldId, event),
    },
  });
  host = defineHost(gameContract, {
    channels: { partyInput: (payload, { peer }) => world.input(peer.userId, payload.frames) },
    streams: {
      partyWorld: { seed: () => [world.keyframe()] },
      partyEvents: { seed: () => world.seedEvents() },
    },
  }).serve(connection, { room });

  // The server's word on who plays: the room's events, heard on the socket
  connection.socket.on("qd:event", ([service, event, payload]) => {
    if (service !== "gameService" || typeof payload !== "object" || payload === null) return;
    const said = payload as { worldId?: string; id?: string; name?: string | null };
    if (said.worldId !== party.worldId || said.id === undefined) return;
    if (event === "partyPlayer") world.play(said.id, said.name ?? null);
    if (event === "partyPlayerLeft") world.leave(said.id);
  });
  world.start();

  return {
    party,
    world,
    close: async () => {
      await callData(connection, {
        service: "gameService",
        method: "closeParty",
        input: { worldId: party.worldId },
        kind: "mutation",
      });
    },
    stop: () => {
      world.stop();
      host?.close();
      connection.close();
    },
  };
}

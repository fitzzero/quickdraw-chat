/**
 * check:godot's party session (host mode): a Node host (party-host.ts)
 * hosts a party on the bench server, and two headless copies of the real
 * game join it by its code (QUICKDRAW_PARTY_CODE), over the server's relay
 * to the host (headless Godot has no WebRTC):
 *
 *   1. both join the party (joinParty, then partyEvents and partyWorld from
 *      the host) and play (playParty: the host spawns them);
 *   2. each sees the other's snake move, from the host's snapshots;
 *   3. a death reaches both on partyEvents, and the dead player respawns
 *      (playParty again);
 *   4. the host ends the party (closeParty): both hear partyClosed.
 */

import { GodotClient, sawMove, step, type Probe } from "./godot-client.js";
import { hostNodeParty } from "./party-host.js";

export interface PartyUsers {
  readonly host: string;
  readonly ada: string;
  readonly bo: string;
}

/** The party's players, and each with the other. */
interface Guests {
  readonly both: readonly GodotClient[];
  readonly pairs: readonly (readonly [GodotClient, GodotClient])[];
}

/** True when a `seen` probe places the local snake: the host spawned it. */
const playing = (probe: Probe): boolean => probe.kind === "seen" && probe.me !== null;

async function checkJoin({ both }: Guests): Promise<void> {
  await step(
    "both join the party over the relay to its host, and the host spawns them",
    async () => {
      for (const client of both) {
        await client.waitFor(
          "hello",
          0,
          (p) => p.kind === "connected" && p.userId === client.userId,
        );
        await client.waitFor("the party's bootstrap", 0, (p) => p.kind === "world");
        await client.waitFor("its snake, from the host", 0, playing);
      }
    },
  );
}

async function checkMove({ pairs }: Guests): Promise<void> {
  await step("each sees the other's snake move, from the host's snapshots", async () => {
    for (const [client, other] of pairs) {
      await client.waitFor(`${other.name} moving`, 0, () => sawMove(client, other, 0));
    }
  });
}

async function checkDeath({ both }: Guests): Promise<void> {
  await step("a death reaches both on partyEvents, and the dead player respawns", async () => {
    const [first, second] = both;
    if (first === undefined || second === undefined) throw new Error("two players expected");
    const death = await first.waitFor("a death", 0, (p) => p.kind === "death");
    await second.waitFor("the same death", 0, (p) => p.kind === "death" && p.id === death.id);
    const dead = both.find((client) => client.userId === death.id);
    // an NPC's death needs no respawn of ours
    if (dead === undefined) return;
    // the dead client's own probe of that death (both hear every death, in
    // order): its snake comes back after it
    const after = dead.probes.findIndex((p) => p.kind === "death" && p.id === death.id);
    await dead.waitFor("its snake again, from the host", after, playing);
  });
}

/** Two headless games join a party a Node host serves; resolves once every check held. */
export async function checkParty(url: string, users: PartyUsers): Promise<void> {
  // no NPCs: the only snakes are the two players', which meet in the centre
  const host = await hostNodeParty(url, users.host, { npcCount: 0 });
  console.log(`check:godot: party ${host.party.code}, hosted by a Node client`);
  const env = { QUICKDRAW_PARTY_CODE: host.party.code };
  const ada = new GodotClient("ada", users.ada, url, env);
  const bo = new GodotClient("bo", users.bo, url, env);
  const guests: Guests = {
    both: [ada, bo],
    pairs: [
      [ada, bo],
      [bo, ada],
    ],
  };
  try {
    await checkJoin(guests);
    await checkMove(guests);
    await checkDeath(guests);
    await step("the host ends the party: both hear partyClosed", async () => {
      const marks = guests.both.map((client) => client.probes.length);
      await host.close();
      for (const [index, client] of guests.both.entries()) {
        await client.waitFor(
          "the party's end",
          marks[index] ?? 0,
          (p) => p.kind === "party_ended" && p.reason === "closed",
        );
      }
    });
  } finally {
    for (const client of guests.both) client.stop();
    host.stop();
  }
}

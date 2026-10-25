/**
 * check:web's party session (host mode): a Node host (party-host.ts) hosts
 * a party on the bench server, and the two pages join it by its code
 * through the pre-game dialog, over the server's relay to the host (a
 * Node host has no WebRTC):
 *
 *   1. both join the party (the dialog's code field: joinParty, then
 *      partyEvents and partyWorld from the host through PartyWire) and
 *      play (Start: playParty, the host spawns them);
 *   2. each sees the other's snake move, from the host's snapshots;
 *   3. a death reaches both on partyEvents, and the dead player respawns
 *      (Respawn: playParty again);
 *   4. the host ends the party (closeParty): both pages say so.
 */

import { hostNodeParty } from "./party-host.js";
import { sawMove, step, type Probe, type WebClient } from "./web-client.js";

/** The party's world is the default size; its centre is where the snakes meet. */
const PARTY_CENTRE = { x: 1200, y: 1200 };

/** The party's players, and each with the other. */
interface Guests {
  readonly both: readonly WebClient[];
  readonly pairs: readonly (readonly [WebClient, WebClient])[];
}

/** True when a `seen` probe places the local snake: the host spawned it. */
const playing = (probe: Probe): boolean => probe.kind === "seen" && probe.me !== null;

async function checkJoin(
  { both }: Guests,
  code: string,
  marks: Map<WebClient, number>,
): Promise<void> {
  await step(
    "both join the party by its code over the relay to its host, and the host spawns them",
    async () => {
      for (const client of both) {
        await client.goToGame();
        await client.fill(/party code/i, code);
        await client.click(/^join$/i);
        await client.waitForText(/you joined this party/i);
        marks.set(client, client.probes.length);
        await client.click(/^start$/i);
      }
      for (const client of both) {
        const from = marks.get(client) ?? 0;
        await client.steer(PARTY_CENTRE.x, PARTY_CENTRE.y);
        await client.waitFor("the party's world", from, (p) => p.kind === "joined");
        await client.waitFor("its snake, from the host", from, playing);
      }
    },
  );
}

async function checkMove({ pairs }: Guests, marks: Map<WebClient, number>): Promise<void> {
  await step("each sees the other's snake move, from the host's snapshots", async () => {
    for (const [client, other] of pairs) {
      const from = marks.get(client) ?? 0;
      await client.waitFor(`${other.name} moving`, from, () => sawMove(client, other, from));
    }
  });
}

async function checkDeath({ both }: Guests, marks: Map<WebClient, number>): Promise<void> {
  await step("a death reaches both on partyEvents, and the dead player respawns", async () => {
    const [first, second] = both;
    if (first === undefined || second === undefined) throw new Error("two players expected");
    const death = await first.waitFor("a death", marks.get(first) ?? 0, (p) => p.kind === "death");
    await second.waitFor(
      "the same death",
      marks.get(second) ?? 0,
      (p) => p.kind === "death" && p.id === death.id,
    );
    const dead = both.find((client) => client.userId === death.id);
    if (dead === undefined) throw new Error(`a death of ${String(death.id)}, neither player`);
    // the dead client's own probe of that death (both hear every death, in
    // order): its snake comes back after it
    const after = dead.probes.findIndex((p) => p.kind === "death" && p.id === death.id);
    await dead.waitFor("its snake again, from the host", after, playing);
  });
}

/** Two pages join a party a Node host serves; resolves once every check held. */
export async function checkParty(url: string, guests: Guests, hostUserId: string): Promise<void> {
  // no NPCs: the only snakes are the two players', which meet in the centre
  const host = await hostNodeParty(url, hostUserId, { npcCount: 0 });
  console.log(`check:web: party ${host.party.code}, hosted by a Node client`);
  const marks = new Map<WebClient, number>();
  try {
    await checkJoin(guests, host.party.code, marks);
    await checkMove(guests, marks);
    await checkDeath(guests, marks);
    await step("the host ends the party: both pages say so", async () => {
      await host.close();
      for (const client of guests.both) {
        await client.waitForText(/the party ended: its host closed it/i);
      }
    });
  } finally {
    host.stop();
  }
}

/**
 * The bridge on the mock client (no server, no host): what the hooks show
 * reaches the transport in order, the seed first as a keyframe; input the
 * transport sends reaches the channel; a keyframe ask remounts the world
 * feed, whose fresh list is a seed again.
 */

import * as React from "react";
import { act, render } from "@testing-library/react";
import { createMockClient } from "@fitzzero/quickdraw-core/testing/client";
import type { GamePlayerMeta, GameWire, PartyEvent, WorldSnapshot } from "@project/shared";
import { contracts } from "@project/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { PartyWire } from "../PartyWire";
import { PartyTransport } from "../wire/partyTransport";

const WORLD = "party-1";
const mock = createMockClient(contracts, { userId: "user-ada" });

const keyframe = (tick: number): WorldSnapshot => ({
  tick,
  players: [],
  food: [{ tick, spawned: [] }],
});
const snapshot = (tick: number): WorldSnapshot => ({ tick, t: tick * 50, players: [] });

function recorder(): GameWire & { keyframes: number[]; snapshots: number[]; gone: string[] } {
  const r = {
    keyframes: [] as number[],
    snapshots: [] as number[],
    gone: [] as string[],
    follow: (): void => undefined,
    snapshot: (s: WorldSnapshot): void => void r.snapshots.push(s.tick),
    keyframe: (k: WorldSnapshot): void => void r.keyframes.push(k.tick),
    death: (): void => undefined,
    left: (id: string): void => void r.gone.push(id),
  };
  return r;
}

async function mounted(): Promise<{
  transport: PartyTransport;
  wire: ReturnType<typeof recorder>;
  players: GamePlayerMeta[];
}> {
  const players: GamePlayerMeta[] = [];
  const transport = new PartyTransport({
    worldId: WORLD,
    bounds: { w: 2400, h: 2400 },
    onPlayer: (meta) => players.push(meta),
  });
  const wire = recorder();
  await transport.start(wire);
  render(<PartyWire worldId={WORLD} transport={transport} enabled client={mock} />, {
    wrapper: mock.$Provider,
  });
  return { transport, wire, players };
}

describe("PartyWire", () => {
  beforeEach(() => {
    mock.$reset();
  });

  it("hands the world feed's seed over as a keyframe and the items after it as snapshots", async () => {
    // the hook keeps each item's identity as the list grows, as the client does
    const k10 = keyframe(10);
    const s11 = snapshot(11);
    const s12 = snapshot(12);
    mock.gameService.partyWorld.mockItems(WORLD, [k10]);
    const { wire } = await mounted();
    expect(wire.keyframes).toEqual([10]);
    act(() => {
      mock.gameService.partyWorld.mockItems(WORLD, [k10, s11]);
    });
    act(() => {
      mock.gameService.partyWorld.mockItems(WORLD, [k10, s11, s12]);
    });
    expect(wire.snapshots).toEqual([11, 12]);
    expect(wire.keyframes).toEqual([10]);
  });

  it("hands the party's events over in order, the seed's joins included", async () => {
    const joins: PartyEvent[] = [
      { kind: "joined", id: "p1", name: "Ada", hue: 10 },
      { kind: "joined", id: "p2", name: "Bo", hue: 200 },
    ];
    mock.gameService.partyEvents.mockItems(WORLD, joins);
    const { wire, players } = await mounted();
    expect(players.map((p) => p.id)).toEqual(["p1", "p2"]);
    act(() => {
      mock.gameService.partyEvents.mockItems(WORLD, [...joins, { kind: "left", id: "p2" }]);
    });
    expect(wire.gone).toEqual(["p2"]);
  });

  it("sends the transport's input on the channel", async () => {
    const { transport } = await mounted();
    const frames = [{ seq: 1, dx: 0, dy: 1, boost: true }];
    act(() => transport.sendInput(frames));
    expect(mock.gameService.partyInput.sent).toEqual([{ frames }]);
  });

  it("subscribes the world feed again for a keyframe: a fresh list is a seed again", async () => {
    mock.gameService.partyWorld.mockItems(WORLD, [keyframe(10), snapshot(11)]);
    const { transport, wire } = await mounted();
    expect(wire.keyframes).toEqual([10]);
    expect(wire.snapshots).toEqual([11]);
    let asked: Promise<void> | undefined;
    // the ask remounts the world feed; the remounted feed's list is a seed again
    act(() => {
      asked = transport.requestKeyframe();
    });
    await asked;
    expect(wire.keyframes).toEqual([10, 10]);
    expect(wire.snapshots).toEqual([11, 11]);
  });
});

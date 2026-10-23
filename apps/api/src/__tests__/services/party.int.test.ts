// Party worlds on the server (host mode): the row, its code and chat, its
// room and its host, over real protocol 5 sockets. The party's world runs
// in its host's client; here a Node client hosts with defineHost, as the
// web page and check:godot's host do, so the server's half is checked
// against what a host and its players see: the host frame, the party's
// events, who may link to the host, and how a party ends.
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { QuickdrawError, type EventPayloadOf } from "@fitzzero/quickdraw-core";
import {
  callData,
  createPeerLink,
  createQuickdrawConnection,
  defineHost,
  type PeerLink,
  type QuickdrawConnection,
} from "@fitzzero/quickdraw-core/client/core";
import { describeAccessMatrix, eventFrames } from "@fitzzero/quickdraw-core/testing";
import { testDb, testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";
import {
  PARTY_CODE_ALPHABET,
  PARTY_CODE_PREFIX,
  gameContract,
  partyRoom,
  type PartyHosted,
} from "@project/shared";
import { ensureGlobalWorld } from "../../services/game/bootstrap.js";
import { gameService } from "../../services/game/index.js";
import { PARTY_BOUNDS } from "../../services/game/party.js";
import { createTestUser } from "../factories/user-factory.js";
import { startTestApp, user, type ApiConnection, type ApiTestApp } from "../utils/app.js";

type Users = Awaited<ReturnType<typeof seedTestUsers>>;

let app: ApiTestApp;
let users: Users;
/** The sockets and clients a test opened: closed after it. */
let opened: ApiConnection[] = [];
let clients: QuickdrawConnection[] = [];
/** The party rooms a test used: empty again after it. */
let rooms: string[] = [];

const CODE = new RegExp(`^${PARTY_CODE_PREFIX}[${PARTY_CODE_ALPHABET}]{4}$`);

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  users = await seedTestUsers();
  await ensureGlobalWorld(testDb);
});

afterEach(async () => {
  for (const connection of opened) connection.close();
  for (const each of clients) each.close();
  opened = [];
  clients = [];
  await vi.waitFor(() => {
    for (const room of rooms) expect(app.server.rooms.size(room)).toBe(0);
  });
  rooms = [];
});

/** A real protocol 5 socket acting for `userId`. */
async function connect(userId: string): Promise<ApiConnection> {
  const connection = await app.connect(user(userId));
  opened.push(connection);
  return connection;
}

/** A socket of `userId` that hosts a new party: the party, and the socket. */
async function hosting(userId: string): Promise<{ socket: ApiConnection; party: PartyHosted }> {
  const socket = await connect(userId);
  const party = await socket.call.gameService.hostParty({});
  rooms.push(partyRoom(party.worldId));
  return { socket, party };
}

/** The next `event` of the game `connection` receives (one received already counts). */
async function heard<K extends "partyPlayer" | "partyPlayerLeft" | "hostLeft" | "partyClosed">(
  connection: ApiConnection,
  event: K,
  match: (payload: EventPayloadOf<typeof gameContract, K>) => boolean = () => true,
): Promise<EventPayloadOf<typeof gameContract, K>> {
  const { data } = await app.frames.waitFor({
    ...eventFrames(gameContract, event, match),
    socketId: connection.socket.id,
  });
  return data[2];
}

/** The host frame (`qd:host`) the socket heard for `room`: the host's socket id, or null. */
async function hostFrame(
  connection: ApiConnection,
  room: string,
  host: string | null,
): Promise<void> {
  await app.frames.waitFor({
    event: "qd:host",
    socketId: connection.socket.id,
    where: ({ data }) => data[0] === room && data[1] === host,
  });
}

/** A client of the typed client's core (no React), acting for `userId`, once the server said hello. */
async function client(userId: string): Promise<QuickdrawConnection> {
  const connection = createQuickdrawConnection({
    url: app.url,
    auth: { principal: user(userId) },
    transports: ["websocket"],
  });
  clients.push(connection);
  connection.open();
  await new Promise<void>((resolve) => {
    const off = connection.onHello(() => {
      off();
      resolve();
    });
  });
  return connection;
}

/** Resolves with how a link ended up: open, or the reason it closed. */
function settled(link: PeerLink): Promise<string> {
  return new Promise((resolve) => {
    if (link.state === "open") resolve("open");
    link.on("open", () => resolve("open"));
    link.on("close", () => resolve(link.closeReason ?? "closed"));
  });
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  const error = await promise.then(
    () => null,
    (failure: unknown) => failure,
  );
  expect(error).toBeInstanceOf(QuickdrawError);
  expect((error as QuickdrawError).code).toBe(code);
}

describe("hosting and joining a party", () => {
  it("hostParty makes the party's row, a code and its chat, and makes the calling socket its host", async () => {
    const { socket, party } = await hosting(users.regular.id);
    expect(party.code).toMatch(CODE);

    const room = partyRoom(party.worldId);
    await hostFrame(socket, room, socket.socket.id ?? null);
    expect(app.server.rooms.hostOf(room)).toBe(socket.socket.id);

    const row = await testPrisma.gameWorld.findUniqueOrThrow({ where: { id: party.worldId } });
    expect(row).toMatchObject({
      kind: "party",
      code: party.code,
      hostUserId: users.regular.id,
      chatId: party.chatId,
      closedAt: null,
    });
    // its slug says nothing of its code
    expect(row.slug).not.toContain(party.code.toLowerCase());
    // the host is its chat's Admin, as a chat's maker is
    const member = await testPrisma.chatMember.findFirst({
      where: { chatId: party.chatId ?? "", userId: users.regular.id },
    });
    expect(member?.level).toBe("Admin");
  });

  it("refuses hostParty and joinParty without a socket: a party's world goes over peer links", async () => {
    await expectCode(app.as(user(users.regular.id)).gameService.hostParty({}), "VALIDATION");
    const { party } = await hosting(users.regular.id);
    await expectCode(
      app.as(user(users.moderator.id)).gameService.joinParty({ code: party.code }),
      "VALIDATION",
    );
  });

  it("joinParty finds the party by its code, typed in any case, and names its host", async () => {
    const { socket: host, party } = await hosting(users.regular.id);
    const guest = await connect(users.moderator.id);

    const bootstrap = await guest.call.gameService.joinParty({
      code: ` ${party.code.toLowerCase()} `,
    });
    expect(bootstrap).toMatchObject({
      worldId: party.worldId,
      chatId: party.chatId,
      code: party.code,
      hostUserId: users.regular.id,
      hostSocketId: host.socket.id,
      bounds: PARTY_BOUNDS,
      players: [],
      snaps: [],
      food: [],
    });
    // the guest's socket is in the room, and heard who hosts it
    const room = partyRoom(party.worldId);
    await hostFrame(guest, room, host.socket.id ?? null);
    expect(app.server.rooms.size(room)).toBe(2);
    // and the guest is in the party's chat
    const member = await testPrisma.chatMember.findFirst({
      where: { chatId: party.chatId ?? "", userId: users.moderator.id },
    });
    expect(member?.level).toBe("Read");
  });

  it("joinParty refuses a code no open party has", async () => {
    const guest = await connect(users.moderator.id);
    await expectCode(guest.call.gameService.joinParty({ code: "BAP-ZZZZ" }), "NOT_FOUND");
  });

  it("joinParty refuses a party without a host, and leaves the socket out of its room", async () => {
    const { party } = await hosting(users.regular.id);
    const room = partyRoom(party.worldId);
    app.server.rooms.clearHost(room);
    const guest = await connect(users.moderator.id);

    await expectCode(guest.call.gameService.joinParty({ code: party.code }), "NOT_FOUND");
    expect(app.server.rooms.size(room)).toBe(1);
  });

  it("joinParty refuses a user who tried too many wrong codes, the right one too", async () => {
    const { party } = await hosting(users.regular.id);
    const guesser = await connect((await createTestUser()).id);
    for (let i = 0; i < 10; i++) {
      await expectCode(guesser.call.gameService.joinParty({ code: "BAP-ZZZZ" }), "NOT_FOUND");
    }
    await expectCode(guesser.call.gameService.joinParty({ code: party.code }), "RATE_LIMITED");
  });

  it("joining another party takes the socket out of the first: its host hears the user leave", async () => {
    const first = await hosting(users.regular.id);
    const second = await hosting(users.admin.id);
    const guest = await connect(users.moderator.id);
    await guest.call.gameService.joinParty({ code: first.party.code });

    await guest.call.gameService.joinParty({ code: second.party.code });
    expect(
      await heard(first.socket, "partyPlayerLeft", (p) => p.worldId === first.party.worldId),
    ).toEqual({ worldId: first.party.worldId, id: users.moderator.id });
    await vi.waitFor(() => expect(app.server.rooms.size(partyRoom(first.party.worldId))).toBe(1));
    expect(app.server.rooms.size(partyRoom(second.party.worldId))).toBe(2);
  });

  it("playParty tells the room who asked to play, by the server's name for them", async () => {
    const { socket: host, party } = await hosting(users.regular.id);
    const guest = await connect(users.moderator.id);
    await guest.call.gameService.joinParty({ code: party.code });

    await guest.call.gameService.playParty({ worldId: party.worldId });
    const { name } = await testPrisma.user.findUniqueOrThrow({
      where: { id: users.moderator.id },
      select: { name: true },
    });
    expect(await heard(host, "partyPlayer")).toEqual({
      worldId: party.worldId,
      id: users.moderator.id,
      name,
    });
  });

  it("playParty refuses a user the party's room does not hold: the code is the invitation", async () => {
    const { party } = await hosting(users.regular.id);
    const stranger = await connect(users.moderator.id);

    await expectCode(stranger.call.gameService.playParty({ worldId: party.worldId }), "FORBIDDEN");
    expect(app.server.rooms.size(partyRoom(party.worldId))).toBe(1);
  });

  it("a party's chat is for the users its room holds, and getWorld finds no party", async () => {
    const { party } = await hosting(users.regular.id);
    const stranger = await connect(users.moderator.id);

    await expectCode(
      stranger.call.chatService.joinWorldChat({ worldId: party.worldId }),
      "FORBIDDEN",
    );
    const row = await testPrisma.gameWorld.findUniqueOrThrow({ where: { id: party.worldId } });
    expect(await app.as(null).gameService.getWorld({ slug: row.slug })).toBeNull();
  });

  it("names to the room a user whose last socket left it, not one whose other socket stays", async () => {
    const { socket: host, party } = await hosting(users.regular.id);
    const page = await connect(users.moderator.id);
    const game = await connect(users.moderator.id);
    await page.call.gameService.joinParty({ code: party.code });
    await game.call.gameService.joinParty({ code: party.code });

    page.close();
    await vi.waitFor(() => expect(app.server.rooms.size(partyRoom(party.worldId))).toBe(2));
    const left = eventFrames(gameContract, "partyPlayerLeft", (p) => p.worldId === party.worldId);
    expect(app.frames(left)).toEqual([]);

    await game.call.gameService.leaveParty({ worldId: party.worldId });
    expect(await heard(host, "partyPlayerLeft")).toEqual({
      worldId: party.worldId,
      id: users.moderator.id,
    });
  });
});

describe("how a party ends", () => {
  it("closeParty, for its host, tells the room and takes everyone out", async () => {
    const { socket: host, party } = await hosting(users.regular.id);
    const guest = await connect(users.moderator.id);
    await guest.call.gameService.joinParty({ code: party.code });

    await expectCode(guest.call.gameService.closeParty({ worldId: party.worldId }), "FORBIDDEN");

    await host.call.gameService.closeParty({ worldId: party.worldId });
    expect(await heard(guest, "partyClosed")).toEqual({ worldId: party.worldId });
    const room = partyRoom(party.worldId);
    await vi.waitFor(() => expect(app.server.rooms.size(room)).toBe(0));
    expect(app.server.rooms.hostOf(room)).toBeNull();
    const row = await testPrisma.gameWorld.findUniqueOrThrow({ where: { id: party.worldId } });
    expect(row.closedAt).not.toBeNull();
    // its code is free again
    expect(row.code).toBeNull();
    await expectCode(guest.call.gameService.joinParty({ code: party.code }), "NOT_FOUND");
    // and its chat is no longer the guest's to join
    await expectCode(guest.call.chatService.joinWorldChat({ worldId: party.worldId }), "FORBIDDEN");
  });

  it("the host's leaveParty ends the party: its room hears hostLeft", async () => {
    const { socket: host, party } = await hosting(users.regular.id);
    const guest = await connect(users.moderator.id);
    await guest.call.gameService.joinParty({ code: party.code });

    await host.call.gameService.leaveParty({ worldId: party.worldId });
    expect(await heard(guest, "hostLeft")).toEqual({ worldId: party.worldId });
    await expectCode(guest.call.gameService.playParty({ worldId: party.worldId }), "NOT_FOUND");
  });

  it("the host's disconnect ends the party: its room hears hostLeft", async () => {
    const { socket: host, party } = await hosting(users.regular.id);
    const guest = await connect(users.moderator.id);
    await guest.call.gameService.joinParty({ code: party.code });

    host.close();
    expect(await heard(guest, "hostLeft")).toEqual({ worldId: party.worldId });
    await hostFrame(guest, partyRoom(party.worldId), null);
    await vi.waitFor(async () => {
      const row = await testPrisma.gameWorld.findUniqueOrThrow({ where: { id: party.worldId } });
      expect(row.closedAt).not.toBeNull();
    });
  });

  it("hosting a second party ends the first: a socket is in one party at a time", async () => {
    const first = await hosting(users.regular.id);
    const guest = await connect(users.moderator.id);
    await guest.call.gameService.joinParty({ code: first.party.code });

    const second = await first.socket.call.gameService.hostParty({});
    rooms.push(partyRoom(second.worldId));
    expect(await heard(guest, "partyClosed")).toEqual({ worldId: first.party.worldId });
    expect(second.code).not.toBe(first.party.code);
    expect(app.server.rooms.hostOf(partyRoom(second.worldId))).toBe(first.socket.socket.id);
  });
});

describe("the party's host over peer links", () => {
  /** A Node client hosting a party with defineHost, as the web page does: its links, by state. */
  async function nodeHost(userId: string): Promise<{ party: PartyHosted; socketId: string }> {
    const connection = await client(userId);
    const party = await callData<PartyHosted>(connection, {
      service: "gameService",
      method: "hostParty",
      input: {},
      kind: "mutation",
    });
    rooms.push(partyRoom(party.worldId));
    defineHost(gameContract, {
      channels: { partyInput: () => undefined },
      streams: {
        partyWorld: { seed: () => [{ tick: 0, players: [] }] },
        partyEvents: { seed: () => [] },
      },
    }).serve(connection, { room: partyRoom(party.worldId) });
    return { party, socketId: connection.socket.id ?? "" };
  }

  it("links a player of the room to its host, and refuses a socket outside the room", async () => {
    const { party, socketId } = await nodeHost(users.regular.id);
    const room = partyRoom(party.worldId);

    const player = await client(users.moderator.id);
    await callData(player, {
      service: "gameService",
      method: "joinParty",
      input: { code: party.code },
      kind: "query",
    });
    const joined = createPeerLink(player, { room, to: socketId, offerer: true, relay: "always" });
    expect(await settled(joined)).toBe("open");

    // a stranger never called joinParty: the server forwards no signal of its
    const stranger = await client((await createTestUser()).id);
    const refused = createPeerLink(stranger, {
      room,
      to: socketId,
      offerer: true,
      relay: "always",
    });
    expect(await settled(refused)).toBe("refused");
  });
});

describe("party access matrix", () => {
  it("admits each party method's callers", async () => {
    const host = user(users.regular.id);
    const gameAdmin = await createTestUser({ serviceAccess: { gameService: "Admin" } });
    /** A fresh party per cell, hosted by `host`'s socket (each ends the one before). */
    const fresh = async (): Promise<PartyHosted> => (await hosting(users.regular.id)).party;
    await describeAccessMatrix(app, {
      service: gameService,
      principals: { host, player: user(users.moderator.id), gameAdmin: user(gameAdmin.id) },
      cases: [
        // in process there is no socket to host with: access passed, the handler refuses
        {
          method: "hostParty",
          input: {},
          expect: { host: "VALIDATION", player: "VALIDATION", gameAdmin: "VALIDATION" },
        },
        // in process there is no socket to join with either
        {
          method: "joinParty",
          input: async () => ({ code: (await fresh()).code }),
          expect: { host: "VALIDATION", player: "VALIDATION", gameAdmin: "VALIDATION" },
        },
        // a user the party's room holds: its host's socket is in it, the others never joined
        {
          method: "playParty",
          input: async () => ({ worldId: (await fresh()).worldId }),
          expect: { host: "allow", player: "FORBIDDEN", gameAdmin: "FORBIDDEN" },
        },
        {
          method: "leaveParty",
          input: async () => ({ worldId: (await fresh()).worldId }),
          allow: ["host", "player", "gameAdmin"],
        },
        // the host's row (the policy gives its hostUserId Admin), or a service-wide Admin
        {
          method: "closeParty",
          input: async () => ({ worldId: (await fresh()).worldId }),
          allow: ["host", "gameAdmin"],
        },
      ],
    });
  });
});

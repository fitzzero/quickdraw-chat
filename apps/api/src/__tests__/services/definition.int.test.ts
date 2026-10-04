import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";
import type { DefinitionDTO } from "@project/shared";
import { startTestServer } from "../utils/server.js";
import { connectAsUser, emitWithAck } from "../utils/socket.js";
import { createTestUser } from "../factories/user-factory.js";

describe("DefinitionService Integration", () => {
  let stop: () => Promise<void>;
  let port: number;
  let users: Awaited<ReturnType<typeof seedTestUsers>>;

  beforeAll(async () => {
    const server = await startTestServer();
    port = server.port;
    stop = server.stop;
  });

  afterAll(async () => {
    await stop();
  });

  beforeEach(async () => {
    await resetDatabase();
    users = await seedTestUsers();
    await testPrisma.definition.create({
      data: {
        type: "tunables",
        key: "snake",
        data: { baseSpeed: 200, turnRate: 5 },
      },
    });
    await testPrisma.definition.create({
      data: {
        type: "tunables",
        key: "disabled-thing",
        data: { x: 1 },
        enabled: false,
      },
    });
  });

  it("lists enabled definitions publicly (any authenticated user)", async () => {
    const client = await connectAsUser(port, users.regular.id);

    const all = await emitWithAck<{ type?: string }, DefinitionDTO[]>(
      client,
      "definitionService:listDefinitions",
      {},
    );
    expect(all.map((d) => d.key)).toEqual(["snake"]);
    expect(all[0]?.data).toEqual({ baseSpeed: 200, turnRate: 5 });

    const filtered = await emitWithAck<{ type?: string }, DefinitionDTO[]>(
      client,
      "definitionService:listDefinitions",
      { type: "nope" },
    );
    expect(filtered).toEqual([]);

    client.close();
  });

  it("getDefinition returns a single row and hides disabled rows", async () => {
    const client = await connectAsUser(port, users.regular.id);

    const snake = await emitWithAck<{ type: string; key: string }, DefinitionDTO | null>(
      client,
      "definitionService:getDefinition",
      { type: "tunables", key: "snake" },
    );
    expect(snake?.data["baseSpeed"]).toBe(200);

    const disabled = await emitWithAck<{ type: string; key: string }, DefinitionDTO | null>(
      client,
      "definitionService:getDefinition",
      { type: "tunables", key: "disabled-thing" },
    );
    expect(disabled).toBeNull();

    client.close();
  });

  it("admin can edit definitions; regular users cannot", async () => {
    const admin = await createTestUser({ serviceAccess: { definitionService: "Admin" } });
    const adminClient = await connectAsUser(port, admin.id);
    const regularClient = await connectAsUser(port, users.regular.id);

    const row = await testPrisma.definition.findUniqueOrThrow({
      where: { type_key: { type: "tunables", key: "snake" } },
      select: { id: true },
    });

    const updated = await emitWithAck<
      { id: string; data: Record<string, unknown> },
      { data: Record<string, unknown> } | null
    >(adminClient, "definitionService:adminUpdate", {
      id: row.id,
      data: { data: { baseSpeed: 250 } },
    });
    expect(updated?.data).toEqual({ baseSpeed: 250 });

    await expect(
      emitWithAck(regularClient, "definitionService:adminUpdate", {
        id: row.id,
        data: { data: { baseSpeed: 999 } },
      }),
    ).rejects.toThrow();

    adminClient.close();
    regularClient.close();
  });

  it("subscribe payloads go through toDto (ISO updatedAt, not a Date)", async () => {
    // subscribe checks the service-level ACL, unlike the Public read methods.
    const reader = await createTestUser({ serviceAccess: { definitionService: "Read" } });
    const client = await connectAsUser(port, reader.id);

    const row = await testPrisma.definition.findUniqueOrThrow({
      where: { type_key: { type: "tunables", key: "snake" } },
      select: { id: true },
    });

    const snapshot = await emitWithAck<{ entryId: string }, Partial<DefinitionDTO>>(
      client,
      "definitionService:subscribe",
      { entryId: row.id },
    );

    // Socket.IO serializes a Date to an ISO string on the wire, so the type
    // alone proves nothing. The DTO shape is what distinguishes them: toDto
    // drops createdAt and maps `data` to a plain record.
    expect(typeof snapshot.updatedAt).toBe("string");
    expect(snapshot).not.toHaveProperty("createdAt");
    expect(Object.keys(snapshot).sort()).toEqual([
      "data",
      "enabled",
      "id",
      "key",
      "type",
      "updatedAt",
      "version",
    ]);

    client.close();
  });

  it("admin edits hot-reload the game sim tunables via onChanged", async () => {
    // Wire a fresh service pair directly (unit-ish, no sockets needed)
    // quickdraw-migrate: review [server] DefinitionService is imported dynamically here, and 5.0 has no class: import the service object definitionService (pass it in qd.createServer({ services: [...] })), or call it through qd.caller(principal)
    const { DefinitionService } = await import("../../services/definition/index.js");
    // quickdraw-migrate: review [server] GameService is imported dynamically here, and 5.0 has no class: import the service object gameService (pass it in qd.createServer({ services: [...] })), or call it through qd.caller(principal)
    const { GameService } = await import("../../services/game/index.js");
    // quickdraw-migrate: review [server] the 4.x service was constructed here (new DefinitionService(...)): it is the object definitionService now
    const definitionService = new DefinitionService(testPrisma);
    // quickdraw-migrate: review [server] the 4.x service was constructed here (new GameService(...)): it is the object gameService now
    const gameService = new GameService(testPrisma, { simSeed: 1 });

    // quickdraw-migrate: review [server] definitionService is a 4.x DefinitionService instance, whose members (onChanged here) the service object definitionService does not have: call a contract method through qd.caller(principal).definitionService.<method>(input), and move other logic into a module of its own
    definitionService.onChanged((definition) => {
      if (definition.type === "tunables" && definition.key === "snake") {
        // quickdraw-migrate: review [server] gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
        gameService.sim.applyTunables(definition.data);
      }
    });

    // quickdraw-migrate: review [server] gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
    const before = gameService.sim.tunables.baseSpeed;
    const admin = await createTestUser({ serviceAccess: { definitionService: "Admin" } });
    const adminClient = await connectAsUser(port, admin.id);
    void adminClient; // ACL exercised in the previous test; here we drive the hook directly

    const row = await testPrisma.definition.findUniqueOrThrow({
      where: { type_key: { type: "tunables", key: "snake" } },
      select: { id: true },
    });
    // Drive adminUpdate on the locally-wired service instance
    await (
      definitionService as unknown as {
        adminUpdate: (id: string, data: unknown) => Promise<unknown>;
      }
    ).adminUpdate(row.id, { data: { baseSpeed: 260 } });

    expect(before).not.toBe(260);
    // quickdraw-migrate: review [server] gameService is a 4.x GameService instance, whose members (sim here) the service object gameService does not have: call a contract method through qd.caller(principal).gameService.<method>(input), and move other logic into a module of its own
    expect(gameService.sim.tunables.baseSpeed).toBe(260);

    adminClient.close();
  });
});

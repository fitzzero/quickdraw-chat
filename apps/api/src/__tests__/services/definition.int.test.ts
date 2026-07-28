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

  it("admin edits hot-reload the game sim tunables via onChanged", async () => {
    // Wire a fresh service pair directly (unit-ish, no sockets needed)
    const { DefinitionService } = await import("../../services/definition/index.js");
    const { GameService } = await import("../../services/game/index.js");
    const definitionService = new DefinitionService(testPrisma);
    const gameService = new GameService(testPrisma, { simSeed: 1 });

    definitionService.onChanged((definition) => {
      if (definition.type === "tunables" && definition.key === "snake") {
        gameService.sim.applyTunables(definition.data);
      }
    });

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
    expect(gameService.sim.tunables.baseSpeed).toBe(260);

    adminClient.close();
  });
});

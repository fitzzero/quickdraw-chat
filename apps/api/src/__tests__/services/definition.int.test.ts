// Definitions on 5.0: the public reads, the admin kit, and the tunables hot
// reload its writes drive.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { describeAccessMatrix } from "@fitzzero/quickdraw-core/testing";
import { testDb, testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";
import {
  definitionService,
  notifyChanged,
  onChanged,
  type ChangedDefinition,
} from "../../services/definition/index.js";
import { snakeTunablesOf } from "../../services/game/bootstrap.js";
import { gameRuntime } from "../../services/game/runtime.js";
import { createTestUser } from "../factories/user-factory.js";
import { startTestApp, type ApiTestApp } from "../utils/app.js";

let app: ApiTestApp;

/** The definitions every edit was announced with, since the file started. */
const heard: ChangedDefinition[] = [];
// What the API's start-up does (index.ts): an edit of the snake tunables
// reaches the running sim
onChanged((definition) => {
  heard.push(definition);
  if (definition.type === "tunables" && definition.key === "snake") {
    gameRuntime(testDb).sim.applyTunables(snakeTunablesOf(definition.data));
  }
});

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  await testPrisma.definition.create({
    data: { type: "tunables", key: "snake", data: { baseSpeed: 200, turnRate: 5 } },
  });
  await testPrisma.definition.create({
    data: { type: "tunables", key: "disabled-thing", data: { x: 1 }, enabled: false },
  });
});

describe("DefinitionService", () => {
  it("lists enabled definitions publicly", async () => {
    const all = await app.as(null).definitionService.listDefinitions({});
    expect(all.map((d) => d.key)).toEqual(["snake"]);
    expect(all[0]?.data).toEqual({ baseSpeed: 200, turnRate: 5 });
    expect(typeof all[0]?.updatedAt).toBe("string");

    expect(await app.as(null).definitionService.listDefinitions({ type: "nope" })).toEqual([]);
  });

  it("getDefinition answers one row and hides disabled rows", async () => {
    const snake = await app.as(null).definitionService.getDefinition({
      type: "tunables",
      key: "snake",
    });
    expect(snake?.data["baseSpeed"]).toBe(200);

    const disabled = await app.as(null).definitionService.getDefinition({
      type: "tunables",
      key: "disabled-thing",
    });
    expect(disabled).toBeNull();
  });

  it("tells its listeners about an edited definition, which the game sim applies", async () => {
    heard.length = 0;
    const sim = gameRuntime(testDb).sim;
    const row = await testPrisma.definition.update({
      where: { type_key: { type: "tunables", key: "snake" } },
      data: { data: { baseSpeed: 260 } },
    });

    notifyChanged({ type: row.type, key: row.key, data: { baseSpeed: 260 } });

    expect(heard.map((d) => d.key)).toEqual(["snake"]);
    expect(sim.tunables.baseSpeed).toBe(260);
  });
});

describe("DefinitionService admin kit", () => {
  async function snakeId(): Promise<string> {
    const row = await testPrisma.definition.findUniqueOrThrow({
      where: { type_key: { type: "tunables", key: "snake" } },
      select: { id: true },
    });
    return row.id;
  }

  it("service administrators edit definitions through the admin kit; others are refused", async () => {
    const editor = await createTestUser({ serviceAccess: { definitionService: "Admin" } });
    const asEditor = app.as({ userId: editor.id });
    const id = await snakeId();

    // every row, the disabled one too
    const page = await asEditor.definitionService.adminList({ sort: { field: "key" } });
    expect(page.items.map((d) => d.key)).toEqual(["disabled-thing", "snake"]);

    const updated = await asEditor.definitionService.adminUpdate({
      id,
      data: { data: { baseSpeed: 250 } },
    });
    expect(updated.data).toEqual({ baseSpeed: 250 });
    const created = await asEditor.definitionService.adminCreate({
      data: { type: "items", key: "apple", data: { value: 2 }, version: 1, enabled: true },
    });
    expect(created.key).toBe("apple");

    const { regular, admin } = await seedTestUsers();
    for (const userId of [regular.id, admin.id]) {
      await expect(
        app.as({ userId }).definitionService.adminUpdate({
          id,
          data: { data: { baseSpeed: 999 } },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(app.as(null).definitionService.adminList({})).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("an admin edit of the snake tunables hot-reloads the running sim", async () => {
    const editor = await createTestUser({ serviceAccess: { definitionService: "Admin" } });
    const sim = gameRuntime(testDb).sim;
    expect(sim.tunables.baseSpeed).not.toBe(275);
    heard.length = 0;

    await app.as({ userId: editor.id }).definitionService.adminUpdate({
      id: await snakeId(),
      data: { data: { baseSpeed: 275, turnRate: 5 } },
    });

    expect(heard.map((d) => [d.type, d.key])).toEqual([["tunables", "snake"]]);
    expect(sim.tunables.baseSpeed).toBe(275);
  });
});

describe("DefinitionService access matrix", () => {
  it("admits each method's callers", async () => {
    const editor = await createTestUser({ serviceAccess: { definitionService: "Admin" } });
    // a player holds no grant on definitions; Admin elsewhere is not enough
    const player = await createTestUser();
    const otherAdmin = await createTestUser({ serviceAccess: { gameService: "Admin" } });
    const { id: snake } = await testPrisma.definition.findUniqueOrThrow({
      where: { type_key: { type: "tunables", key: "snake" } },
      select: { id: true },
    });
    let made = 0;
    /** A definition of its own, for one cell that deletes it. */
    const doomed = async (): Promise<{ id: string }> => {
      made += 1;
      return await testPrisma.definition.create({
        data: { type: "items", key: `doomed-${made}`, data: {} },
        select: { id: true },
      });
    };
    /** A new definition's fields, a key of its own for each cell. */
    const fresh = (): {
      data: {
        type: string;
        key: string;
        data: Record<string, unknown>;
        version: number;
        enabled: boolean;
      };
    } => {
      made += 1;
      return { data: { type: "items", key: `fresh-${made}`, data: {}, version: 1, enabled: true } };
    };

    await describeAccessMatrix(app, {
      service: definitionService,
      principals: {
        editor: { userId: editor.id },
        player: { userId: player.id },
        otherAdmin: { userId: otherAdmin.id },
      },
      cases: [
        {
          method: "listDefinitions",
          input: {},
          allow: ["editor", "player", "otherAdmin", "anonymous"],
        },
        {
          method: "getDefinition",
          input: { type: "tunables", key: "snake" },
          allow: ["editor", "player", "otherAdmin", "anonymous"],
        },
        { method: "adminList", input: {}, allow: ["editor"] },
        { method: "adminGet", input: { id: snake }, allow: ["editor"] },
        { method: "adminCreate", input: fresh, allow: ["editor"] },
        {
          method: "adminUpdate",
          input: { id: snake, data: { data: { baseSpeed: 210 } } },
          allow: ["editor"],
        },
        { method: "adminDelete", input: doomed, allow: ["editor"] },
        { method: "adminMeta", input: {}, allow: ["editor"] },
      ],
    });
  });
});

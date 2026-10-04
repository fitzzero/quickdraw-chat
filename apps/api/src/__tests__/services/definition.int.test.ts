// Definitions on 5.0: the public reads. quickdraw-game: the admin surface
// (the admin kit) and the tunables hot reload it drives move with the game's
// own port (pack child 4); their cases are listed as todos below.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testDb, testPrisma, resetDatabase } from "@project/db/testing";
import type { DefinitionDTO } from "@project/shared";
import { notifyChanged, onChanged } from "../../services/definition/index.js";
import { gameRuntime } from "../../services/game/runtime.js";
import { startTestApp, type ApiTestApp } from "../utils/app.js";

let app: ApiTestApp;

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
    const heard: DefinitionDTO[] = [];
    const sim = gameRuntime(testDb).sim;
    onChanged((definition) => {
      heard.push(definition);
      if (definition.type === "tunables" && definition.key === "snake") {
        sim.applyTunables(definition.data);
      }
    });
    const row = await testPrisma.definition.update({
      where: { type_key: { type: "tunables", key: "snake" } },
      data: { data: { baseSpeed: 260 } },
    });

    notifyChanged(row);

    expect(heard.map((d) => d.key)).toEqual(["snake"]);
    expect(sim.tunables.baseSpeed).toBe(260);
  });
});

// quickdraw-game: back with the game's 5.0 port (child 4)
describe("DefinitionService admin surface (the game's port)", () => {
  it.todo("service administrators edit definitions through the admin kit; others are refused");
  it.todo("an admin edit of the snake tunables hot-reloads the running sim");
});

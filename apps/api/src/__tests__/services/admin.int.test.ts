// The admin screens' edit allowlists. Each service's admin.contract names the
// only fields adminCreate and adminUpdate write (`editable`), and the kit
// applies the contract's list to its handlers: a service-wide Admin edits a
// listed field, any other answers VALIDATION before anything is written, and
// adminMeta reports exactly the listed fields as editable (what the admin
// screens' forms leave read-only).

import { QuickdrawError } from "@fitzzero/quickdraw-core";
import { testPrisma } from "@project/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestChat, createTestMessage } from "../factories/chat-factory.js";
import { createTestUser } from "../factories/user-factory.js";
import { startTestApp, user, type ApiTestApp } from "../utils/app.js";

let app: ApiTestApp;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
});

/** An in-process caller with a service-wide Admin grant on every service the admin screens edit. */
async function asAdmin(): Promise<ReturnType<ApiTestApp["as"]>> {
  const person = await createTestUser({ name: "Admin" });
  return app.as({
    ...user(person.id),
    serviceAccess: {
      chatService: "Admin",
      documentService: "Admin",
      messageService: "Admin",
      userService: "Admin",
      // ── quickdraw-game:start ──
      gameService: "Admin",
      definitionService: "Admin",
      // ── quickdraw-game:end ──
    },
  });
}

/** The code a call failed with. */
async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return "allow";
  } catch (error) {
    return error instanceof QuickdrawError ? error.code : String(error);
  }
}

/** The fields adminMeta reports editable, sorted. */
function editableOf(meta: {
  readonly fields: readonly { readonly name: string; readonly editable: boolean }[];
}): string[] {
  return meta.fields
    .filter((field) => field.editable)
    .map((field) => field.name)
    .sort();
}

describe("the admin screens' edit allowlists", () => {
  it("chats: a rename, never the latest activity messageService keeps", async () => {
    const admin = await asAdmin();
    const owner = await createTestUser();
    const chat = await createTestChat({ members: [{ userId: owner.id }] });

    expect(editableOf(await admin.chatService.adminMeta({}))).toEqual(["title"]);
    await admin.chatService.adminUpdate({ id: chat.id, data: { title: "Renamed" } });
    expect(
      await codeOf(
        admin.chatService.adminUpdate({
          id: chat.id,
          // @ts-expect-error -- outside the contract's list: refused by the types, and by the input check from a caller without them
          data: { lastMessageAt: new Date(0).toISOString() },
        }),
      ),
    ).toBe("VALIDATION");
    const row = await testPrisma.chat.findUniqueOrThrow({ where: { id: chat.id } });
    expect(row.title).toBe("Renamed");
    expect(row.lastMessageAt.getTime()).not.toBe(0);
  });

  it("documents: the title and the content, never the owner", async () => {
    const admin = await asAdmin();
    const [owner, other] = await Promise.all([createTestUser(), createTestUser()]);
    const document = await testPrisma.document.create({
      data: { title: "Notes", ownerId: owner.id },
      select: { id: true },
    });

    expect(editableOf(await admin.documentService.adminMeta({}))).toEqual(["content", "title"]);
    await admin.documentService.adminUpdate({ id: document.id, data: { content: "Edited" } });
    expect(
      await codeOf(
        admin.documentService.adminUpdate({
          id: document.id,
          // @ts-expect-error -- outside the contract's list: refused by the types, and by the input check from a caller without them
          data: { ownerId: other.id },
        }),
      ),
    ).toBe("VALIDATION");
    expect(
      await testPrisma.document.findUniqueOrThrow({ where: { id: document.id } }),
    ).toMatchObject({ content: "Edited", ownerId: owner.id });
  });

  it("messages: the text, never the chat or the author", async () => {
    const admin = await asAdmin();
    const [author, other] = await Promise.all([createTestUser(), createTestUser()]);
    const chat = await createTestChat({ members: [{ userId: author.id }] });
    const elsewhere = await createTestChat({ members: [{ userId: other.id }] });
    const message = await createTestMessage({ chatId: chat.id, userId: author.id });

    expect(editableOf(await admin.messageService.adminMeta({}))).toEqual(["content"]);
    await admin.messageService.adminUpdate({ id: message.id, data: { content: "Corrected" } });
    expect(
      await codeOf(
        admin.messageService.adminUpdate({
          id: message.id,
          // @ts-expect-error -- outside the contract's list: refused by the types, and by the input check from a caller without them
          data: { chatId: elsewhere.id },
        }),
      ),
    ).toBe("VALIDATION");
    expect(
      await codeOf(
        admin.messageService.adminUpdate({
          id: message.id,
          // @ts-expect-error -- outside the contract's list: refused by the types, and by the input check from a caller without them
          data: { userId: other.id },
        }),
      ),
    ).toBe("VALIDATION");
    expect(await testPrisma.message.findUniqueOrThrow({ where: { id: message.id } })).toMatchObject(
      {
        content: "Corrected",
        chatId: chat.id,
        userId: author.id,
      },
    );
  });

  it("users: every field the admin screens edit, the grants included", async () => {
    const admin = await asAdmin();

    expect(editableOf(await admin.userService.adminMeta({}))).toEqual([
      "email",
      "image",
      // ── quickdraw-game:start ──
      "isGuest",
      // ── quickdraw-game:end ──
      "name",
      "serviceAccess",
    ]);
  });

  // ── quickdraw-game:start ──
  it("game worlds: the name and the slug, never the chat the server links", async () => {
    const admin = await asAdmin();
    const world = await testPrisma.gameWorld.create({
      data: { slug: "admin-test", name: "World" },
      select: { id: true },
    });
    const chat = await createTestChat({ members: [{ userId: (await createTestUser()).id }] });

    expect(editableOf(await admin.gameService.adminMeta({}))).toEqual(["name", "slug"]);
    await admin.gameService.adminUpdate({ id: world.id, data: { name: "Renamed" } });
    expect(
      await codeOf(
        admin.gameService.adminUpdate({
          id: world.id,
          // @ts-expect-error -- outside the contract's list: refused by the types, and by the input check from a caller without them
          data: { chatId: chat.id },
        }),
      ),
    ).toBe("VALIDATION");
    expect(await testPrisma.gameWorld.findUniqueOrThrow({ where: { id: world.id } })).toMatchObject(
      { name: "Renamed", chatId: null },
    );
  });

  it("definitions: every field of the content", async () => {
    const admin = await asAdmin();

    expect(editableOf(await admin.definitionService.adminMeta({}))).toEqual([
      "data",
      "enabled",
      "key",
      "type",
      "version",
    ]);
  });
  // ── quickdraw-game:end ──
});

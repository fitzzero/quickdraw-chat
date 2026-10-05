import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { QuickdrawError } from "@fitzzero/quickdraw-core";
import { describeAccessMatrix, expectBudget } from "@fitzzero/quickdraw-core/testing";
import { testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";
import { documentService } from "../../services/document/index.js";
import { startTestApp, subscribeEntity, type ApiTestApp } from "../utils/app.js";
import { createTestUser } from "../factories/user-factory.js";

type Users = Awaited<ReturnType<typeof seedTestUsers>>;

let app: ApiTestApp;
let users: Users;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDatabase();
  users = await seedTestUsers();
  app.frames.clear();
});

function as(userId: string): ReturnType<ApiTestApp["as"]> {
  return app.as({ userId });
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return "allow";
  } catch (error) {
    return error instanceof QuickdrawError ? error.code : String(error);
  }
}

describe("DocumentService (read/write kit)", () => {
  it("creates a document owned by the caller", async () => {
    const created = await as(users.regular.id).documentService.create({
      title: "My Document",
      content: "Document content here",
    });
    expect(created).toMatchObject({ title: "My Document", ownerId: users.regular.id, acl: [] });

    const stored = await testPrisma.document.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.ownerId).toBe(users.regular.id);
  });

  it("lists the documents the caller owns or that are shared with them", async () => {
    const regular = as(users.regular.id);
    await regular.documentService.create({ title: "Doc 1" });
    await regular.documentService.create({ title: "Doc 2" });
    const others = await as(users.moderator.id).documentService.create({ title: "Theirs" });
    const sharedWithMe = await as(users.moderator.id).documentService.create({
      title: "Shared",
    });
    await as(users.moderator.id).documentService.share({
      id: sharedWithMe.id,
      userId: users.regular.id,
      level: "Read",
    });

    const page = await regular.documentService.list({
      sort: { field: "title", direction: "asc" },
    });
    expect(page.items.map((doc) => doc.title)).toEqual(["Doc 1", "Doc 2", "Shared"]);
    expect(page.items.some((doc) => doc.id === others.id)).toBe(false);
  });

  it("gets, updates and deletes a document", async () => {
    const regular = as(users.regular.id);
    const created = await regular.documentService.create({ title: "Draft", content: "v1" });

    expect(await regular.documentService.get({ id: created.id })).toMatchObject({
      title: "Draft",
      content: "v1",
    });
    expect(
      await regular.documentService.update({ id: created.id, title: "Final", content: "v2" }),
    ).toMatchObject({ title: "Final", content: "v2" });
    expect(await regular.documentService.delete({ id: created.id })).toBeNull();
    expect(await testPrisma.document.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it("answers NOT_FOUND for a missing document to a service-wide reader", async () => {
    const reader = await createTestUser({ serviceAccess: { documentService: "Admin" } });
    expect(
      await codeOf(as(reader.id).documentService.get({ id: "ckmissingdoc0000000000000" })),
    ).toBe("NOT_FOUND");
  });

  it("sends an edit to the document's subscribers", async () => {
    const owner = as(users.regular.id);
    const created = await owner.documentService.create({ title: "Live" });
    await owner.documentService.share({
      id: created.id,
      userId: users.moderator.id,
      level: "Read",
    });
    const reader = await app.connect({ userId: users.moderator.id });
    await subscribeEntity(reader, "documentService", created.id);
    app.frames.clear();

    await owner.documentService.update({ id: created.id, content: "Edited" });

    const frame = await app.frames.waitFor({ event: "qd:e", userId: users.moderator.id });
    expect(frame.data).toMatchObject({
      s: "documentService",
      id: created.id,
      d: { content: "Edited" },
    });
    reader.close();
  });
});

describe("DocumentService (sharing kit on the access list)", () => {
  it("refuses a document to a user it is not shared with", async () => {
    const created = await as(users.regular.id).documentService.create({ title: "Private" });
    expect(await codeOf(as(users.moderator.id).documentService.get({ id: created.id }))).toBe(
      "FORBIDDEN",
    );
  });

  it("shares a document, then takes it back", async () => {
    const owner = as(users.regular.id);
    const created = await owner.documentService.create({ title: "Shared Doc" });

    const shares = await owner.documentService.share({
      id: created.id,
      userId: users.moderator.id,
      level: "Read",
    });
    expect(shares).toEqual([{ userId: users.moderator.id, level: "Read" }]);
    const reader = as(users.moderator.id);
    expect(await reader.documentService.get({ id: created.id })).toMatchObject({
      title: "Shared Doc",
    });

    await owner.documentService.unshare({ id: created.id, userId: users.moderator.id });
    expect(await codeOf(reader.documentService.get({ id: created.id }))).toBe("FORBIDDEN");
  });

  it("lets a user it is shared with at Read read it, not edit it", async () => {
    const owner = as(users.regular.id);
    const created = await owner.documentService.create({ title: "Shared Doc" });
    await owner.documentService.share({
      id: created.id,
      userId: users.moderator.id,
      level: "Read",
    });

    const reader = as(users.moderator.id);
    expect(await reader.documentService.get({ id: created.id })).not.toBeNull();
    expect(await codeOf(reader.documentService.update({ id: created.id, title: "Hacked" }))).toBe(
      "FORBIDDEN",
    );
    expect((await testPrisma.document.findUniqueOrThrow({ where: { id: created.id } })).title).toBe(
      "Shared Doc",
    );
  });

  it("needs Admin on the document to share it", async () => {
    const owner = as(users.regular.id);
    const created = await owner.documentService.create({ title: "Delegated" });
    const editor = await createTestUser();
    await owner.documentService.share({ id: created.id, userId: editor.id, level: "Moderate" });

    // an Admin share (or a service-wide Admin grant) is needed to share at all
    expect(
      await codeOf(
        as(editor.id).documentService.share({
          id: created.id,
          userId: users.moderator.id,
          level: "Read",
        }),
      ),
    ).toBe("FORBIDDEN");
  });
});

describe("DocumentService budgets", () => {
  it("costs a fixed number of statements to share a document two readers watch", async () => {
    const owner = as(users.regular.id);
    const doc = await owner.documentService.create({ title: "Watched" });
    await owner.documentService.share({ id: doc.id, userId: users.moderator.id, level: "Read" });
    // the row's live subscribers: its owner and a reader
    const watchers = await Promise.all(
      [users.regular.id, users.moderator.id].map((userId) => app.connect({ userId })),
    );
    for (const watcher of watchers) {
      expect(await subscribeEntity(watcher, "documentService", doc.id)).toMatchObject({ ok: true });
    }
    // a first share pays one-time reads
    await owner.documentService.share({ id: doc.id, userId: users.admin.id, level: "Read" });
    await app.frames.waitFor({ event: "qd:e", userId: users.moderator.id });
    app.frames.clear();
    const newcomer = await createTestUser();

    await expectBudget(
      async () => {
        await owner.documentService.share({ id: doc.id, userId: newcomer.id, level: "Read" });
        await Promise.all(
          [users.regular.id, users.moderator.id].map((userId) =>
            app.frames.waitFor({ event: "qd:e", userId }),
          ),
        );
      },
      { name: "share a document with 2 subscribers" },
    );
    for (const watcher of watchers) {
      watcher.close();
    }
  });
});

describe("documents written before 5.0", () => {
  it("lose the owner's own access-list entry to the 5.0 data migration; listShares lists the shares", async () => {
    const [owner, reader] = await Promise.all([createTestUser(), createTestUser()]);
    // as 4.x's createDocument wrote them: the owner listed as Admin
    const shared = await testPrisma.document.create({
      data: {
        title: "Shared",
        ownerId: owner.id,
        acl: [
          { userId: owner.id, level: "Admin" },
          { userId: reader.id, level: "Read" },
        ],
      },
    });
    const owned = await testPrisma.document.create({
      data: { title: "Owned", ownerId: owner.id, acl: [{ userId: owner.id, level: "Admin" }] },
    });
    const migration = readFileSync(
      resolve(
        process.cwd(),
        "../../packages/db/prisma/migrations/20261004200200_document_acl_without_owner/migration.sql",
      ),
      "utf8",
    );

    await testPrisma.$executeRawUnsafe(migration);

    const aclOf = async (id: string): Promise<unknown> =>
      (await testPrisma.document.findUniqueOrThrow({ where: { id } })).acl;
    expect(await aclOf(shared.id)).toEqual([{ userId: reader.id, level: "Read" }]);
    expect(await aclOf(owned.id)).toEqual([]);
    expect(await as(owner.id).documentService.listShares({ id: shared.id })).toEqual([
      { userId: reader.id, level: "Read" },
    ]);
    // the owner keeps Admin, from owner_id
    expect(await codeOf(as(owner.id).documentService.delete({ id: owned.id }))).toBe("allow");
  });
});

describe("DocumentService access matrix", () => {
  it("admits each method's callers", async () => {
    const [ownerUser, editorUser, readerUser, stranger] = await Promise.all([
      createTestUser(),
      createTestUser(),
      createTestUser(),
      createTestUser(),
    ]);
    const owner = as(ownerUser.id);
    const doc = await owner.documentService.create({ title: "Matrix" });
    await owner.documentService.share({ id: doc.id, userId: editorUser.id, level: "Moderate" });
    await owner.documentService.share({ id: doc.id, userId: readerUser.id, level: "Read" });
    const toDelete = await owner.documentService.create({ title: "Gone" });
    /** A share with a user of its own, for one share cell. */
    const shareWithNewcomer = async (): Promise<{ id: string; userId: string; level: "Read" }> => ({
      id: doc.id,
      userId: (await createTestUser()).id,
      level: "Read",
    });
    /** A user the document is shared with, for one unshare cell. */
    const sharedWithSomeone = async (): Promise<string> => {
      const shared = await createTestUser();
      await owner.documentService.share({ id: doc.id, userId: shared.id, level: "Read" });
      return shared.id;
    };

    await describeAccessMatrix(app, {
      service: documentService,
      principals: {
        owner: { userId: ownerUser.id },
        editor: { userId: editorUser.id },
        reader: { userId: readerUser.id },
        stranger: { userId: stranger.id },
      },
      cases: [
        { method: "get", input: { id: doc.id }, allow: ["owner", "editor", "reader"] },
        { method: "list", input: {}, allow: ["owner", "editor", "reader", "stranger"] },
        {
          method: "create",
          input: { title: "New" },
          allow: ["owner", "editor", "reader", "stranger"],
        },
        { method: "update", input: { id: doc.id, content: "x" }, allow: ["owner", "editor"] },
        { method: "listShares", input: { id: doc.id }, allow: ["owner", "editor", "reader"] },
        {
          method: "setLevel",
          input: { id: doc.id, userId: readerUser.id, level: "Read" },
          allow: ["owner"],
        },
        { method: "share", input: shareWithNewcomer, allow: ["owner"] },
        {
          method: "unshare",
          input: async () => ({ id: doc.id, userId: await sharedWithSomeone() }),
          allow: ["owner"],
        },
        { method: "delete", input: { id: toDelete.id }, allow: ["owner"] },
        { method: "adminList", input: {}, allow: [] },
      ],
    });
  });
});

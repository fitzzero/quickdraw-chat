import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";
import { startTestServer } from "../utils/server.js";
import { connectAsUser, emitWithAck } from "../utils/socket.js";
import type { DocumentDTO } from "@project/shared";

describe("DocumentService Integration", () => {
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
  });

  // ============================================================================
  // CRUD Operations
  // ============================================================================

  it("should create a document", async () => {
    const client = await connectAsUser(port, users.regular.id);

    const result = await emitWithAck<{ title: string; content?: string }, { id: string }>(
      client,
      "documentService:createDocument",
      {
        title: "My Document",
        content: "Document content here",
      },
    );

    expect(result.id).toBeDefined();

    // Verify in database
    const dbDoc = await testPrisma.document.findUnique({
      where: { id: result.id },
    });
    expect(dbDoc).not.toBeNull();
    expect(dbDoc?.title).toBe("My Document");
    expect(dbDoc?.ownerId).toBe(users.regular.id);

    client.close();
  });

  it("should list user's documents", async () => {
    const client = await connectAsUser(port, users.regular.id);

    await emitWithAck(client, "documentService:createDocument", {
      title: "Doc 1",
    });
    await emitWithAck(client, "documentService:createDocument", {
      title: "Doc 2",
    });

    const result = await emitWithAck<{ page?: number; pageSize?: number }, DocumentDTO[]>(
      client,
      "documentService:listMyDocuments",
      {},
    );

    expect(result).toHaveLength(2);

    client.close();
  });

  it("should get a document by ID", async () => {
    const client = await connectAsUser(port, users.regular.id);

    const created = await emitWithAck<{ title: string; content?: string }, { id: string }>(
      client,
      "documentService:createDocument",
      {
        title: "Test Doc",
        content: "Test content",
      },
    );

    const result = await emitWithAck<{ id: string }, DocumentDTO | null>(
      client,
      "documentService:getDocument",
      { id: created.id },
    );

    expect(result).not.toBeNull();
    expect(result?.title).toBe("Test Doc");
    expect(result?.content).toBe("Test content");

    client.close();
  });

  it("should update a document", async () => {
    const client = await connectAsUser(port, users.regular.id);

    const created = await emitWithAck<{ title: string }, { id: string }>(
      client,
      "documentService:createDocument",
      { title: "Original" },
    );

    const result = await emitWithAck<
      { id: string; title?: string; content?: string },
      DocumentDTO | null
    >(client, "documentService:updateDocument", {
      id: created.id,
      title: "Updated Title",
      content: "New content",
    });

    expect(result?.title).toBe("Updated Title");
    expect(result?.content).toBe("New content");

    client.close();
  });

  it("should delete a document", async () => {
    const client = await connectAsUser(port, users.regular.id);

    const created = await emitWithAck<{ title: string }, { id: string }>(
      client,
      "documentService:createDocument",
      { title: "To Delete" },
    );

    const result = await emitWithAck<{ id: string }, { id: string; deleted: true }>(
      client,
      "documentService:deleteDocument",
      { id: created.id },
    );

    expect(result.deleted).toBe(true);

    const dbDoc = await testPrisma.document.findUnique({
      where: { id: created.id },
    });
    expect(dbDoc).toBeNull();

    client.close();
  });

  // ============================================================================
  // ACL - JSON ACL Pattern
  // ============================================================================

  it("should not allow non-owner to access document", async () => {
    const owner = await connectAsUser(port, users.regular.id);
    const created = await emitWithAck<{ title: string }, { id: string }>(
      owner,
      "documentService:createDocument",
      { title: "Private Doc" },
    );
    owner.close();

    const other = await connectAsUser(port, users.moderator.id);
    await expect(
      emitWithAck<{ id: string }, DocumentDTO | null>(other, "documentService:getDocument", {
        id: created.id,
      }),
    ).rejects.toThrow("Insufficient permissions");

    other.close();
  });

  it("should allow sharing document with another user", async () => {
    const owner = await connectAsUser(port, users.regular.id);
    const created = await emitWithAck<{ title: string }, { id: string }>(
      owner,
      "documentService:createDocument",
      { title: "Shared Doc" },
    );

    // Share with moderator
    await emitWithAck(owner, "documentService:shareDocument", {
      id: created.id,
      userId: users.moderator.id,
      level: "Read",
    });
    owner.close();

    // Moderator should now be able to access
    const shared = await connectAsUser(port, users.moderator.id);
    const result = await emitWithAck<{ id: string }, DocumentDTO | null>(
      shared,
      "documentService:getDocument",
      { id: created.id },
    );

    expect(result).not.toBeNull();
    expect(result?.title).toBe("Shared Doc");

    shared.close();
  });

  it("should allow unsharing document", async () => {
    const owner = await connectAsUser(port, users.regular.id);
    const created = await emitWithAck<{ title: string }, { id: string }>(
      owner,
      "documentService:createDocument",
      { title: "Shared Doc" },
    );

    // Share then unshare
    await emitWithAck(owner, "documentService:shareDocument", {
      id: created.id,
      userId: users.moderator.id,
      level: "Read",
    });
    await emitWithAck(owner, "documentService:unshareDocument", {
      id: created.id,
      userId: users.moderator.id,
    });
    owner.close();

    // Moderator should no longer have access
    const shared = await connectAsUser(port, users.moderator.id);
    await expect(
      emitWithAck<{ id: string }, DocumentDTO | null>(shared, "documentService:getDocument", {
        id: created.id,
      }),
    ).rejects.toThrow("Insufficient permissions");

    shared.close();
  });

  it("should enforce access levels when sharing", async () => {
    const owner = await connectAsUser(port, users.regular.id);
    const created = await emitWithAck<{ title: string }, { id: string }>(
      owner,
      "documentService:createDocument",
      { title: "Shared Doc" },
    );

    // Share with Read access
    await emitWithAck(owner, "documentService:shareDocument", {
      id: created.id,
      userId: users.moderator.id,
      level: "Read",
    });
    owner.close();

    // Moderator can read but not update (requires Moderate)
    const shared = await connectAsUser(port, users.moderator.id);

    // Should be able to read
    const readResult = await emitWithAck<{ id: string }, DocumentDTO | null>(
      shared,
      "documentService:getDocument",
      { id: created.id },
    );
    expect(readResult).not.toBeNull();

    // Should NOT be able to update
    await expect(
      emitWithAck(shared, "documentService:updateDocument", {
        id: created.id,
        title: "Hacked",
      }),
    ).rejects.toThrow();

    shared.close();
  });
});

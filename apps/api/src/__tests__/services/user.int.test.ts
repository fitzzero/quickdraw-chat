import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";
import { startTestServer } from "../utils/server.js";
import { connectAsUser, emitWithAck } from "../utils/socket.js";
import type { User } from "@project/db";
import type { AdminServiceMeta } from "@fitzzero/quickdraw-core";

describe("UserService Integration - Protected Fields", () => {
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

  it("should return email when user subscribes to themselves", async () => {
    const client = await connectAsUser(port, users.regular.id);

    const result = await emitWithAck<{ entryId: string }, Partial<User>>(
      client,
      "userService:subscribe",
      { entryId: users.regular.id }
    );

    expect(result.id).toBe(users.regular.id);
    expect(result.name).toBe("Regular User");
    expect(result.email).toBe(users.regular.email); // Self: should see email

    client.close();
  });

  it("should NOT return email when user subscribes to another user", async () => {
    const client = await connectAsUser(port, users.regular.id);

    const result = await emitWithAck<{ entryId: string }, Partial<User>>(
      client,
      "userService:subscribe",
      { entryId: users.admin.id }
    );

    expect(result.id).toBe(users.admin.id);
    expect(result.name).toBe("Admin User"); // Should see name
    expect(result.email).toBeUndefined(); // Should NOT see email (protected field)

    client.close();
  });
});

describe("UserService Integration - Admin Methods", () => {
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
  // Admin CRUD - Positive Tests (Admin user)
  // ============================================================================

  it("should allow admin to list users via adminList", async () => {
    const client = await connectAsUser(port, users.admin.id);

    const result = await emitWithAck<
      { page?: number; pageSize?: number },
      { items: Partial<User>[]; total: number; page: number; pageSize: number; totalPages: number }
    >(client, "userService:adminList", { page: 1, pageSize: 20 });

    expect(result.items).toHaveLength(3); // admin, moderator, regular from seed
    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.totalPages).toBe(1);

    client.close();
  });

  it("should allow admin to get user by ID via adminGet", async () => {
    const client = await connectAsUser(port, users.admin.id);

    const result = await emitWithAck<{ id: string }, Partial<User>>(
      client,
      "userService:adminGet",
      { id: users.regular.id }
    );

    expect(result.id).toBe(users.regular.id);
    expect(result.name).toBe("Regular User");
    expect(result.email).toBe("user@test.com");

    client.close();
  });

  it("should allow admin to create user via adminCreate", async () => {
    const client = await connectAsUser(port, users.admin.id);

    const result = await emitWithAck<
      { data: { email: string; name: string } },
      Partial<User>
    >(client, "userService:adminCreate", {
      data: { email: "newuser@test.com", name: "New User" },
    });

    expect(result.id).toBeDefined();
    expect(result.email).toBe("newuser@test.com");
    expect(result.name).toBe("New User");

    // Verify in database
    const dbUser = await testPrisma.user.findUnique({
      where: { id: result.id },
    });
    expect(dbUser).not.toBeNull();
    expect(dbUser?.email).toBe("newuser@test.com");

    client.close();
  });

  it("should allow admin to update user via adminUpdate", async () => {
    const client = await connectAsUser(port, users.admin.id);

    const result = await emitWithAck<
      { id: string; data: { name: string } },
      Partial<User>
    >(client, "userService:adminUpdate", {
      id: users.regular.id,
      data: { name: "Updated Name" },
    });

    expect(result.id).toBe(users.regular.id);
    expect(result.name).toBe("Updated Name");

    // Verify in database
    const dbUser = await testPrisma.user.findUnique({
      where: { id: users.regular.id },
    });
    expect(dbUser?.name).toBe("Updated Name");

    client.close();
  });

  it("should allow admin to delete user via adminDelete", async () => {
    const client = await connectAsUser(port, users.admin.id);

    const result = await emitWithAck<
      { id: string },
      { id: string; success: boolean }
    >(client, "userService:adminDelete", { id: users.regular.id });

    expect(result.id).toBe(users.regular.id);
    expect(result.success).toBe(true);

    // Verify deleted from database
    const dbUser = await testPrisma.user.findUnique({
      where: { id: users.regular.id },
    });
    expect(dbUser).toBeNull();

    client.close();
  });

  it("should return service metadata via adminMeta", async () => {
    const client = await connectAsUser(port, users.admin.id);

    const result = await emitWithAck<Record<string, never>, AdminServiceMeta>(
      client,
      "userService:adminMeta",
      {}
    );

    expect(result.serviceName).toBe("userService");
    expect(result.displayName).toBe("Users");
    expect(result.fields).toBeDefined();
    expect(Array.isArray(result.fields)).toBe(true);
    // Check that expected fields are present
    const fieldNames = result.fields.map((f) => f.name);
    expect(fieldNames).toContain("id");
    expect(fieldNames).toContain("email");
    expect(fieldNames).toContain("name");

    client.close();
  });

  // ============================================================================
  // Admin CRUD - Negative Tests (Non-admin user)
  // ============================================================================

  it("should deny non-admin from using adminList", async () => {
    const client = await connectAsUser(port, users.regular.id);

    await expect(
      emitWithAck(client, "userService:adminList", { page: 1, pageSize: 20 })
    ).rejects.toThrow();

    client.close();
  });

  it("should deny non-admin from using adminCreate", async () => {
    const client = await connectAsUser(port, users.regular.id);

    await expect(
      emitWithAck(client, "userService:adminCreate", {
        data: { email: "hacker@test.com", name: "Hacker" },
      })
    ).rejects.toThrow();

    // Verify user was not created
    const dbUser = await testPrisma.user.findUnique({
      where: { email: "hacker@test.com" },
    });
    expect(dbUser).toBeNull();

    client.close();
  });

  it("should deny non-admin from using adminDelete", async () => {
    const client = await connectAsUser(port, users.regular.id);

    await expect(
      emitWithAck(client, "userService:adminDelete", { id: users.moderator.id })
    ).rejects.toThrow();

    // Verify user was not deleted
    const dbUser = await testPrisma.user.findUnique({
      where: { id: users.moderator.id },
    });
    expect(dbUser).not.toBeNull();

    client.close();
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { resetDatabase, seedTestUsers } from "@project/db/testing";
import { startTestServer } from "../utils/server.js";
import { connectAsUser, emitWithAck } from "../utils/socket.js";
import type { User } from "@project/db";

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

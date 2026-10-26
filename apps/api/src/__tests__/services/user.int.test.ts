import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { QuickdrawError } from "@fitzzero/quickdraw-core";
import { describeAccessMatrix } from "@fitzzero/quickdraw-core/testing";
import { testPrisma, resetDatabase, seedTestUsers } from "@project/db/testing";
import { userService } from "../../services/user/index.js";
import { agent, startTestApp, subscribeEntity, user, type ApiTestApp } from "../utils/app.js";
import { signIn, signInProfile } from "../utils/auth.js";
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
  return app.as(user(userId));
}

async function codeOf(call: Promise<unknown>): Promise<string> {
  try {
    await call;
    return "allow";
  } catch (error) {
    return error instanceof QuickdrawError ? error.code : String(error);
  }
}

describe("UserService field tiers (email and grants at Admin)", () => {
  it("sends a user their own email", async () => {
    const socket = await app.connect(user(users.regular.id));
    const reply = await subscribeEntity(socket, "userService", users.regular.id);
    expect(reply).toMatchObject({
      ok: true,
      r: [
        { ok: true, d: { id: users.regular.id, name: "Regular User", email: users.regular.email } },
      ],
    });
    socket.close();
  });

  it("sends another user's profile without their email", async () => {
    const socket = await app.connect(user(users.regular.id));
    const reply = await subscribeEntity(socket, "userService", users.admin.id);
    expect(reply).toMatchObject({ ok: true, r: [{ ok: true, d: { name: "Admin User" } }] });
    if (!reply.ok) throw new Error("expected rows");
    const [row] = reply.r as readonly { ok: true; d: Record<string, unknown> }[];
    expect(row?.d).not.toHaveProperty("email");
    expect(row?.d).not.toHaveProperty("serviceAccess");
    socket.close();
  });

  it("answers getMe with the caller's own row, email and grants included", async () => {
    const me = await as(users.admin.id).userService.getMe({});
    expect(me).toMatchObject({ id: users.admin.id, email: users.admin.email });
    expect(me?.serviceAccess).toMatchObject({ userService: "Admin" });
  });
});

describe("UserService admin kit", () => {
  it("lists every user, with their emails, for a service-wide Admin", async () => {
    const page = await as(users.admin.id).userService.adminList({ page: 1, pageSize: 20 });
    expect(page.items).toHaveLength(3);
    expect(page).toMatchObject({ total: 3, page: 1, pageSize: 20, totalPages: 1 });
    expect(page.items.map((row) => row.email).sort()).toEqual(
      ["admin@test.com", "moderator@test.com", "user@test.com"].sort(),
    );
  });

  it("gets a user by id", async () => {
    const row = await as(users.admin.id).userService.adminGet({ id: users.regular.id });
    expect(row).toMatchObject({
      id: users.regular.id,
      name: "Regular User",
      email: "user@test.com",
    });
  });

  it("creates, updates and deletes a user", async () => {
    const admin = as(users.admin.id);
    const created = await admin.userService.adminCreate({
      data: {
        email: "newuser@test.com",
        name: "New User",
        image: null,
        // ── quickdraw-game:start ──
        isGuest: false,
        // ── quickdraw-game:end ──
      },
    });
    expect(created).toMatchObject({ email: "newuser@test.com", name: "New User" });

    const updated = await admin.userService.adminUpdate({
      id: users.regular.id,
      data: { name: "Updated Name" },
    });
    expect(updated.name).toBe("Updated Name");
    expect(
      (await testPrisma.user.findUniqueOrThrow({ where: { id: users.regular.id } })).name,
    ).toBe("Updated Name");

    expect(await admin.userService.adminDelete({ id: created.id })).toBeNull();
    expect(await testPrisma.user.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it("describes the user fields, grants included (edited by their own editor: no column, no form field)", async () => {
    const meta = await as(users.admin.id).userService.adminMeta({});
    expect(meta.serviceName).toBe("userService");
    expect(meta.displayName).toBe("Users");
    const names = meta.fields.map((field) => field.name);
    expect(names).toEqual(expect.arrayContaining(["id", "email", "name", "serviceAccess"]));
    expect(meta.fields.find((field) => field.name === "serviceAccess")).toMatchObject({
      type: "json",
      kind: "grants",
      editable: true,
      showInTable: false,
      showInForm: false,
    });
  });

  it("refuses everyone without a service-wide Admin grant", async () => {
    const regular = as(users.regular.id);
    expect(await codeOf(regular.userService.adminList({ page: 1, pageSize: 20 }))).toBe(
      "FORBIDDEN",
    );
    expect(
      await codeOf(
        regular.userService.adminCreate({
          data: {
            email: "hacker@test.com",
            name: "Hacker",
            image: null,
            // ── quickdraw-game:start ──
            isGuest: false,
            // ── quickdraw-game:end ──
          },
        }),
      ),
    ).toBe("FORBIDDEN");
    expect(await codeOf(regular.userService.adminDelete({ id: users.moderator.id }))).toBe(
      "FORBIDDEN",
    );
    expect(await testPrisma.user.findUnique({ where: { email: "hacker@test.com" } })).toBeNull();
    expect(await testPrisma.user.findUnique({ where: { id: users.moderator.id } })).not.toBeNull();
  });
});

describe("UserService updateUser and grants", () => {
  it("answers { error: 'name_taken' } for a taken name", async () => {
    const regular = as(users.regular.id);
    expect(
      await regular.userService.updateUser({ id: users.regular.id, data: { name: "Admin User" } }),
    ).toEqual({ error: "name_taken" });
    const ok = await regular.userService.updateUser({
      id: users.regular.id,
      data: { name: "Fresh Name" },
    });
    expect(ok).toMatchObject({ name: "Fresh Name" });
  });

  it("refuses to update another user, whatever userService Read grant the caller has", async () => {
    // SERVICE_DEFAULT_ACCESS gives every user userService: Read (setup.ts)
    expect(
      await codeOf(
        as(users.regular.id).userService.updateUser({
          id: users.moderator.id,
          data: { name: "Hijacked" },
        }),
      ),
    ).toBe("FORBIDDEN");
  });

  it("answers a userService Moderate the changed public profile, never the user's email (UPDATEUSER-ANSWER)", async () => {
    const victim = await createTestUser({ name: "Victim", email: "victim@secret.example" });
    const userModerator = await createTestUser({
      name: "User Mod",
      serviceAccess: { userService: "Moderate" },
    });

    const answer = await as(userModerator.id).userService.updateUser({
      id: victim.id,
      data: { name: "Victim Renamed" },
    });
    expect(answer).toEqual({ id: victim.id, name: "Victim Renamed", image: null });
    expect(JSON.stringify(answer)).not.toContain("victim@secret.example");
    // ...as the same caller's subscription to that user strips it
    const socket = await app.connect(user(userModerator.id));
    const reply = await subscribeEntity(socket, "userService", victim.id);
    expect(JSON.stringify(reply)).not.toContain("victim@secret.example");
    socket.close();
  });

  it("takes an https avatar only", async () => {
    const self = as(users.regular.id);
    for (const image of [
      "http://tracker.example.com/pixel.png",
      "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
      "javascript:alert(1)",
    ]) {
      expect(
        await codeOf(self.userService.updateUser({ id: users.regular.id, data: { image } })),
      ).toBe("VALIDATION");
    }
    expect(
      await self.userService.updateUser({
        id: users.regular.id,
        data: { image: "https://cdn.example.com/avatar.png" },
      }),
    ).toMatchObject({ image: "https://cdn.example.com/avatar.png" });
    const stored = await testPrisma.user.findUniqueOrThrow({ where: { id: users.regular.id } });
    expect(stored.image).toBe("https://cdn.example.com/avatar.png");
  });

  it("replaces a user's grants through adminUpdate and refreshes their open sockets", async () => {
    const target = await app.connect(user(users.regular.id));
    expect(target.hello.serviceAccess).toEqual({ userService: "Read" });
    app.frames.clear();

    const updated = await as(users.admin.id).userService.adminUpdate({
      id: users.regular.id,
      data: { serviceAccess: { chatService: "Moderate" } },
    });
    expect(updated.serviceAccess).toEqual({ chatService: "Moderate" });

    const frame = await app.frames.waitFor({ event: "qd:access", userId: users.regular.id });
    expect(frame.data).toMatchObject({
      serviceAccess: { chatService: "Moderate", userService: "Read" },
    });
    target.close();
  });

  it("writes grants only for a caller whose own userService grant is Admin", async () => {
    // Admin on every other service, Moderate on userService: not enough
    const chatAdmin = await createTestUser({
      serviceAccess: { chatService: "Admin", userService: "Moderate" },
    });
    expect(
      await codeOf(
        as(chatAdmin.id).userService.adminUpdate({
          id: users.regular.id,
          data: { serviceAccess: { chatService: "Admin" } },
        }),
      ),
    ).toBe("FORBIDDEN");
    // the user themself holds Admin on their own row, which is not a grant
    expect(
      await codeOf(
        as(users.regular.id).userService.adminUpdate({
          id: users.regular.id,
          data: { serviceAccess: { userService: "Admin" } },
        }),
      ),
    ).toBe("FORBIDDEN");
    const stored = await testPrisma.user.findUniqueOrThrow({ where: { id: users.regular.id } });
    expect(stored.serviceAccess).toBeNull();
  });
});

describe("UserService live sign-ins", () => {
  it("tells a user's own socket the address a later sign-in verifies", async () => {
    // a first sign-in without a verified address: the user gets the placeholder
    const userId = await signIn(
      signInProfile("discord-later", "later@example.com", false),
      "discord",
    );
    if (userId === null) throw new Error("expected a user");
    const socket = await app.connect(user(userId));
    // their own row, where they hold Admin: the email is sent
    expect(await subscribeEntity(socket, "userService", userId)).toMatchObject({
      ok: true,
      r: [{ ok: true, d: { id: userId, email: "discord-later@discord.local" } }],
    });
    app.frames.clear();

    // the same account signs in again, its provider now verifying the address
    expect(await signIn(signInProfile("discord-later", "later@example.com", true), "discord")).toBe(
      userId,
    );

    const frame = await app.frames.waitFor({ event: "qd:e", userId });
    expect(frame.data).toMatchObject({
      s: "userService",
      id: userId,
      d: { email: "later@example.com" },
    });
    socket.close();
  });
});

describe("UserService access matrix", () => {
  it("admits each method's callers", async () => {
    const [self, other] = await Promise.all([createTestUser(), createTestUser()]);
    await describeAccessMatrix(app, {
      service: userService,
      principals: {
        self: user(self.id),
        other: user(other.id),
        userAdmin: user(users.admin.id),
        // an agent acting for the userService Admin: it reads users and edits
        // profiles (updateUser), and through the admin kit creates, edits
        // (grants included) and deletes none (kinds: ["user"])
        agentAdmin: agent(users.admin.id),
      },
      cases: [
        { method: "getMe", input: {}, allow: ["self", "other", "userAdmin", "agentAdmin"] },
        {
          method: "updateUser",
          input: { id: self.id, data: { image: "https://example.com/a.png" } },
          allow: ["self", "userAdmin", "agentAdmin"],
        },
        {
          method: "adminCreate",
          input: ({ name }) => ({ data: { email: `created-by-${name}@test.com` } }),
          allow: ["userAdmin"],
        },
        {
          label: "adminUpdate (the user's grants)",
          method: "adminUpdate",
          input: { id: self.id, data: { serviceAccess: {} } },
          allow: ["userAdmin"],
        },
        {
          method: "adminDelete",
          input: async () => ({ id: (await createTestUser()).id }),
          allow: ["userAdmin"],
        },
        { method: "adminGet", input: { id: self.id }, allow: ["userAdmin", "agentAdmin"] },
      ],
    });
  });
});

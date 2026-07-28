import type { SnippetLanguage } from "./CodeBlock";

// ============================================================================
// Curated code excerpts for the feature-card dialogs — real code from this
// repo, trimmed to the demonstrative core (README-style). The GitHub deep
// link is the source of truth; line numbers are best-effort and may drift
// slightly as files evolve.
// ============================================================================

export interface FeatureSnippet {
  /** Repo-relative path (also the GitHub deep-link target). */
  path: string;
  /** 1-indexed line range for the deep link; omit for whole-file links. */
  lines?: [number, number];
  language: SnippetLanguage;
  code: string;
}

export const FEATURE_SNIPPETS: Record<string, FeatureSnippet> = {
  featRealtime: {
    path: "apps/api/src/services/chat/index.ts",
    lines: [179, 205],
    language: "ts",
    code: `this.defineMethod(
  "createChat",
  "Read", // ACL level — checked before the handler runs
  async (payload, ctx) => {
    if (!ctx.userId) throw new Error("Authentication required");

    // Create chat and add creator as Admin (nested write is atomic)
    const chat = await this.prisma.chat.create({
      data: {
        title: payload.title,
        members: { create: [{ userId: ctx.userId, level: "Admin" }] },
      },
      select: { id: true },
    });

    return { id: chat.id };
  },
  { schema: createChatSchema }, // zod-validated payload
);

// ...and the client side is one typed hook:
const createChat = useService("chatService", "createChat");
createChat.mutate({ title: "New chat" });`,
  },

  featAcl: {
    path: "apps/api/src/services/chat/index.ts",
    lines: [118, 131],
    language: "ts",
    code: `// Tier 1: service-level roles (user.serviceAccess) are checked by core.
// Tier 2: per-entry ACL — this service overrides it with a membership table
// (DocumentService shows the JSON-ACL flavor of the same hook).
protected override async checkEntryACL(
  userId: string,
  chatId: string,
  requiredLevel: AccessLevel,
): Promise<boolean> {
  const member = await this.prisma.chatMember.findUnique({
    where: { chatId_userId: { chatId, userId } },
    select: { level: true },
  });

  if (!member) return false;
  return this.isLevelSufficient(member.level as AccessLevel, requiredLevel);
}`,
  },

  // ── quickdraw-game:start ──
  featGame: {
    path: "apps/api/src/services/game/index.ts",
    lines: [363, 379],
    language: "ts",
    code: `// Client input at ~tick rate. Fire-and-forget: invalid/unauthorized/
// excess frames are dropped silently; the token bucket replaces the
// global rate limiter for this event.
this.defineChannel(
  "input",
  "Read",
  (payload, ctx) => {
    this.sim.applyInput(ctx.userId, payload);
  },
  {
    schema: gameInputSchema,
    ratePerSecond: GAME_TICK_RATE * 1.5,
    burst: GAME_TICK_RATE * 3,
    requireRoom: () => serviceRoom("gameService", GLOBAL_WORLD_ID),
  },
);

// The Godot client speaks the same wire format (GDScript):
// Net.client.send_channel("gameService", "input", {...})`,
  },
  // ── quickdraw-game:end ──

  featAuth: {
    path: "apps/api/src/auth/guest.ts",
    lines: [64, 98],
    language: "ts",
    code: `app.post("/auth/guest", (req: Request, res: Response) => {
  void (async () => {
    const body = validateRequest(guestBodySchema, req.body, res);
    if (!body) return;

    const user = await createGuestUser(prisma, body.name);
    if (!user) {
      res.status(409).json({ error: "name_taken" });
      return;
    }

    const token = await createJWT({ userId: user.id });
    await prisma.session.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + SESSION_MAX_AGE_MS),
      },
    });

    setSessionCookie(res, token, { maxAgeMs: SESSION_MAX_AGE_MS });
    res.json({ userId: user.id, name: user.name });
  })();
});`,
  },

  featAdmin: {
    path: "apps/api/src/services/chat/index.ts",
    lines: [81, 103],
    language: "ts",
    code: `// One call per service = a full admin CRUD surface at /admin
this.installAdminMethods({
  expose: {
    list: true,
    get: true,
    create: true,
    update: true,
    delete: true,
  },
  access: {
    list: "Admin",
    get: "Admin",
    update: "Admin",
    delete: "Admin",
    setEntryACL: "Admin",
    getSubscribers: "Admin",
  },
  schema: adminChatSchema,
  displayName: "Chats",
  tableColumns: ["id", "title", "createdAt", "updatedAt"],
});`,
  },

  featTesting: {
    path: "apps/api/src/__tests__/services/chat.int.test.ts",
    lines: [11, 35],
    language: "ts",
    code: `// The same suite runs on in-memory PGlite locally (no PostgreSQL,
// seconds) and real PostgreSQL in CI — TEST_DATABASE_URL flips the mode.
beforeAll(async () => {
  const server = await startTestServer();
  port = server.port;
  stop = server.stop;
});

beforeEach(async () => {
  await resetDatabase();
  users = await seedTestUsers();
});

it("should create a chat and become admin", async () => {
  const client = await connectAsUser(port, users.regular.id);

  const result = await emitWithAck<{ title: string }, { id: string }>(
    client,
    "chatService:createChat",
    { title: "Test Chat" },
  );

  expect(result.id).toBeDefined();
});`,
  },

  featDeploy: {
    path: ".github/workflows/deploy.yml",
    lines: [179, 214],
    language: "yaml",
    code: `- name: Deploy to Cloud Run
  uses: google-github-actions/deploy-cloudrun@v2
  with:
    service: \${{ env.SERVICE_NAME }}-api
    image: \${{ env.REGISTRY }}/\${{ secrets.GCP_PROJECT_ID }}/api:\${{ github.sha }}
    region: \${{ env.REGION }}
    flags: >-
      --port=8080
      --cpu=1
      --memory=512Mi
      --min-instances=0
      --max-instances=1
      --session-affinity
      --cpu-boost
      --execution-environment=gen2
      --allow-unauthenticated`,
  },

  featFork: {
    path: "scripts/init-fork.sh",
    lines: [4, 15],
    language: "bash",
    code: `# One-shot template initializer. Run once after forking/cloning:
#
#   ./scripts/init-fork.sh <app-name> [backend-port] [--scope @yourscope] [--without-game]
#   ./scripts/init-fork.sh acme-books 4010
#   ./scripts/init-fork.sh acme-books --without-game   # non-game fork
#
# Rewrites the app identity (database names, titles, deploy service name,
# devcontainer, MCP server name), optionally the backend port and the
# @project/* package scope, refreshes the lockfile, formats, then deletes
# itself. --without-game removes the entire game foundation first.
# Framework references (quickdraw-core, QuickdrawProvider, ...) are untouched.`,
  },

  featGuardrails: {
    path: "eslint-plugin-project/README.md",
    language: "json",
    code: `// .oxlintrc.json — the framework's strict rule set ships WITH the
// package and updates alongside it; the project layer only adds its own.
{
  "extends": ["./node_modules/@fitzzero/quickdraw-core/oxlint.base.jsonc"],
  "plugins": ["typescript", "import", "react", "nextjs", "jsx_a11y"],
  "jsPlugins": [
    {
      "name": "project",
      "specifier": "./eslint-plugin-project/index.mjs"
    }
  ]
}

// eslint-plugin-project/ = your own rules (no-prisma-in-routes ships as
// the example); .claude/rules/*.md = path-scoped guidance Claude Code
// loads automatically when it touches matching files.`,
  },
};

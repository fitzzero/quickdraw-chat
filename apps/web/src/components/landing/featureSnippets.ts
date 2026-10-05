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
    lines: [120, 140],
    language: "ts",
    code: `// The contract (packages/shared): input, output, a sentence for agents
createChat: mutation({
  input: createChatSchema,
  output: idResultSchema,
  describe: "Creates a chat with the caller as its Admin, plus any members given.",
}),

// The service: who may call it, and a handler writing through the tracked client
createChat: {
  access: "authenticated",
  handler: async ({ input, ctx, db }) =>
    await db.$transaction(async (tx) => {
      const chat = await tx.chat.create({ data: { title: input.title }, select: { id: true } });
      await tx.chatMember.createMany({
        data: [{ chatId: chat.id, userId: ctx.principal.userId, level: "Admin" }],
      });
      return { id: chat.id }; // every member's chat list updates live
    }),
},

// ...and the client side is one typed hook:
const createChat = qd.chatService.createChat.useMutation();
createChat.mutate({ title: "New chat" });`,
  },

  featAcl: {
    path: "apps/api/src/services/chat/index.ts",
    lines: [87, 146],
    language: "ts",
    code: `// The row policy: a user's level on a chat is their ChatMember row's.
// It decides calls, live subscriptions, collections and lists alike
// (DocumentService reads a JSON access list instead: jsonAcl("acl")).
export const chatService = qd.defineService(chatContract, {
  model: "chat",
  access: members({ model: "chatMember", entry: "chatId", user: "userId", level: "level" }),
  collections: { myChats: { scopeAccess: "self" } }, // each user opens their own list
  methods: {
    updateTitle: {
      // Moderate on the chat, or a service-wide Moderate grant
      access: { service: "Moderate", entry: "Moderate" },
      handler: ({ input, db }) =>
        db.chat.update({ where: { id: input.id }, data: { title: input.title } }),
    },
    // ...
  },
});`,
  },

  // ── quickdraw-game:start ──
  featGame: {
    path: "packages/shared/src/contracts/game.ts",
    lines: [196, 222],
    language: "ts",
    code: `// The contract: fire-and-forget input, gated on the world's room
channels: {
  input: {
    payload: gameInputSchema,
    ratePerSecond: GAME_TICK_RATE * 1.5,
    burst: GAME_TICK_RATE * 3,
    requires: { room: GLOBAL_WORLD_ROOM },
  },
},
// Every tick, volatile
streams: {
  world: { item: worldSnapshotSchema, scope: "worldId", volatile: true, access: "public" },
},

// The service: joinGame/watchWorld put the calling socket in the room
input: (payload, ctx) => {
  activeGameRuntime()?.sim.applyInput(ctx.principal.userId, payload);
},
// ...and each subscriber starts from the world now (every snake, all the food)
streams: { world: { seed: () => [runtime.sim.keyframe()], validate: "development" } },

// The Godot client speaks the same wire (quickdraw protocol v5, GDScript):
// Net.client.send_channel("gameService", "input", {...})`,
  },
  // ── quickdraw-game:end ──

  featAuth: {
    path: "apps/api/src/auth/index.ts",
    lines: [88, 104],
    language: "ts",
    code: `// quickdraw's auth routes kit, over the app's Session table:
// /auth/{provider}/start and /callback, /auth/me, /auth/logout(-all)
const keys = { sessions: prismaSessions(prisma), jwtSecret: jwtSecretFromEnv() };
const routes = createAuthRoutes({
  providers: [
    google.optional({ clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }),
    discord.optional({ clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET }),
    mock({ listUsers: () => listMockUsers(prisma) }), // dev sign-in, refused in production
  ],
  ...keys,
  onLogin: (profile, provider) => upsertOAuthUser(prisma, profile, provider),
  allowedOrigins,
  publicUrl: apiUrl(),
});

// Sockets and HTTP calls check the same revocable sessions
qd.createServer({ app, services, db, auth: { authenticate: socketAuth({ ...keys, allowedOrigins }) } });`,
  },

  featAdmin: {
    path: "apps/api/src/services/chat/index.ts",
    lines: [213, 217],
    language: "ts",
    code: `// One spread per service = a full admin surface at /admin
// (packages/shared: the contract half names the sortable fields)
...admin.contract({ entity: chatSchema, sort: ["createdAt", "title", "lastMessageAt"] }),

// apps/api: the server half, open to a service-wide Admin grant
...admin.handlers(chatContract, {
  displayName: "Chats",
  fieldOverrides: { lastMessageAt: { editable: false } }, // kept by postMessage
}),

// Users' grants are edited on the same screens:
...admin.handlers(userContract, { displayName: "Users", grants: true }),`,
  },

  featTesting: {
    path: "apps/api/src/__tests__/services/chat.int.test.ts",
    lines: [357, 398],
    language: "ts",
    code: `// The same suite runs on in-memory PGlite locally (no PostgreSQL,
// seconds) and real PostgreSQL in CI — TEST_DATABASE_URL flips the mode.
const app = await startTestApp(); // every service on quickdraw's test server

// Who may call each method, as each principal and anonymously
await describeAccessMatrix(app, {
  service: chatService,
  principals: {
    owner: { userId: owner.id },
    member: { userId: member.id },
    stranger: { userId: stranger.id },
  },
  cases: [
    { method: "getChatMembers", input: { chatId: chat.id }, allow: ["owner", "member"] },
    { method: "updateTitle", input: { id: chat.id, title: "Renamed" }, allow: ["owner"] },
    { method: "leaveChat", input: { id: chat.id }, allow: ["owner", "member"] },
  ],
});

// The hot paths keep a committed query budget (__budgets__/*.json)
await expectBudget(() => openMyChats(member), { name: "open myChats with 30 chats" });`,
  },

  featDeploy: {
    path: ".github/workflows/deploy.yml",
    lines: [187, 220],
    language: "yaml",
    code: `- name: Deploy to Cloud Run
  uses: google-github-actions/deploy-cloudrun@v2
  with:
    service: \${{ env.SERVICE_NAME }}-api
    image: \${{ env.REGISTRY }}/\${{ secrets.GCP_PROJECT_ID }}/\${{ env.SERVICE_NAME }}/api:\${{ github.sha }}
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
    lines: [4, 17],
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
    path: ".oxlintrc.json",
    language: "json",
    code: `// .oxlintrc.json — quickdraw-lint's template config ships the strict rule
// set and the quickdraw rules (untracked writes, unbounded reads, raw
// sockets, removed APIs, ...) WITH the package, and updates alongside it.
{
  "extends": ["./node_modules/@fitzzero/quickdraw-lint/oxlint.template.jsonc"],
  "plugins": ["typescript", "import", "react", "nextjs", "jsx_a11y"],
  "jsPlugins": [{ "name": "project", "specifier": "./eslint-plugin-project/index.mjs" }]
}

// eslint-plugin-project/ = your own rules; .claude/ = this app's
// path-scoped rules beside quickdraw's own rules and skills, linked in by
// quickdraw-skills and loaded when Claude Code touches matching files.`,
  },
};

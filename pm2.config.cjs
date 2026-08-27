// PM2 process definitions for the reaper1-hosted DEV instance (the built
// "dev-hosted" deploy — real prod deploys to GCP via .github/workflows/
// deploy.yml). Used from the deploy-managed clone at
// ~app-quickdraw-chat/apps/quickdraw-chat-dev by telariel's
// quickdraw-chat-dev-deploy.service:
//   pm2 startOrReload pm2.config.cjs --only quickdraw-chat-dev-api,quickdraw-chat-dev-web
//
// Ports come from .env.dev (scaffolded by tel server enable; matches
// telariel projects.json dev_prod_* — 5015 web / 5016 api).
//
// There is deliberately no plain quickdraw-chat-dev app: interactive dev is
// `bun run dev` in the dev-quickdraw-chat sandbox (`tel dev quickdraw-chat`),
// and a pm2-supervised watcher would fight it over the 3000/4000 ports.
const fs = require("node:fs");
const path = require("node:path");

// .env.dev lives next to this file in the dev-hosted clone (gitignored;
// scaffolded by tel server enable). Absent in interactive checkouts.
function loadEnvFile(name) {
  const file = path.join(__dirname, name);
  if (!fs.existsSync(file)) return {};
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return env;
}
const devEnv = loadEnvFile(".env.dev");

module.exports = {
  apps: [
    {
      name: "quickdraw-chat-dev-api",
      cwd: __dirname,
      script: "apps/api/dist/index.js",
      env: {
        ...devEnv,
        NODE_ENV: "production",
        DOTENV_CONFIG_PATH: path.join(__dirname, ".env.dev"),
      },
      max_memory_restart: "1G",
      time: true,
    },
    {
      name: "quickdraw-chat-dev-web",
      cwd: path.join(__dirname, "apps/web"),
      script: "node_modules/.bin/next",
      args: `start -H 0.0.0.0 -p ${devEnv.FRONTEND_PORT || 5015}`,
      env: { NODE_ENV: "production" },
      max_memory_restart: "1G",
      time: true,
    },
  ],
};

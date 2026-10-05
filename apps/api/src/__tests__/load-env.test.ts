// scripts/load-env.sh, which the API's dev server, the database scripts and
// the MCP server run through: .env.local over .env.infra, and the environment
// the script starts with over both.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = resolve(process.cwd(), "../../scripts/load-env.sh");

/** A repository root of its own: the script, and the two env files. */
const root = mkdtempSync(join(tmpdir(), "load-env-"));
mkdirSync(join(root, "scripts"));
copyFileSync(SCRIPT, join(root, "scripts", "load-env.sh"));
writeFileSync(
  join(root, ".env.infra"),
  ["# defaults", "FROM_INFRA=infra", "SHARED=infra", "STARTED_WITH=infra", ""].join("\n"),
);
writeFileSync(
  join(root, ".env.local"),
  ["SHARED=local", 'LOCAL_ONLY="two words"', "export STARTED_WITH=local"].join("\n"),
);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The environment a command started through the script sees. */
function loaded(env: Record<string, string>): Record<string, string> {
  const output = execFileSync("bash", [join(root, "scripts", "load-env.sh"), "env"], {
    encoding: "utf8",
    // nothing from this process's environment but PATH: no Codespaces or
    // container flags choose another infra file
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...env },
  });
  return Object.fromEntries(
    output
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

describe("scripts/load-env.sh", () => {
  it("layers .env.local over .env.infra", () => {
    expect(loaded({})).toMatchObject({
      FROM_INFRA: "infra",
      SHARED: "local",
      LOCAL_ONLY: "two words",
      STARTED_WITH: "local",
    });
  });

  it("never overrides the environment it starts with, whichever file sets the variable", () => {
    expect(loaded({ STARTED_WITH: "real value", FROM_INFRA: "" })).toMatchObject({
      STARTED_WITH: "real value",
      FROM_INFRA: "",
      SHARED: "local",
    });
  });
});

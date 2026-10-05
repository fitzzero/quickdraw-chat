import { afterEach, describe, expect, it, vi } from "vitest";
import { allowedOriginsFromEnv, isAllowedOrigin } from "./config.js";

const CODESPACE = "https://someone-else-3000.app.github.dev";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("allowedOriginsFromEnv", () => {
  it("in production: CLIENT_URL and EXTRA_ALLOWED_ORIGINS, never a Codespace or localhost", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CLIENT_URL", "https://app.example.com");
    vi.stubEnv("EXTRA_ALLOWED_ORIGINS", "https://staging.example.com");
    const allowed = allowedOriginsFromEnv();

    expect(isAllowedOrigin(allowed, "https://app.example.com")).toBe(true);
    expect(isAllowedOrigin(allowed, "https://staging.example.com")).toBe(true);
    // anyone can open a Codespace: in production it would be a sign-in
    // return, a CORS origin and a cookie origin for any GitHub user
    expect(isAllowedOrigin(allowed, CODESPACE)).toBe(false);
    expect(isAllowedOrigin(allowed, "http://localhost:3000")).toBe(false);
    expect(isAllowedOrigin(allowed, "https://evil.example.com")).toBe(false);
  });

  it("outside production: Codespaces and localhost too", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CLIENT_URL", "http://localhost:3000");
    const allowed = allowedOriginsFromEnv();

    expect(isAllowedOrigin(allowed, "http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin(allowed, "http://localhost:3105")).toBe(true);
    expect(isAllowedOrigin(allowed, CODESPACE)).toBe(true);
    expect(isAllowedOrigin(allowed, "https://evil.example.com")).toBe(false);
    // the patterns are anchored
    expect(isAllowedOrigin(allowed, `${CODESPACE}.evil.example.com`)).toBe(false);
  });
});

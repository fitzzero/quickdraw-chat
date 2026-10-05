import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  allowedOriginsFromEnv,
  apiUrl,
  apiUrlProblem,
  encryptionKeyProblem,
  isAllowedOrigin,
  trustProxyFromEnv,
} from "./config.js";

const CODESPACE = "https://someone-else-3000.app.github.dev";

/** The variables these tests decide by, unset unless a test sets them. */
const URL_VARIABLES = [
  "API_URL",
  "CLIENT_URL",
  "EXTRA_ALLOWED_ORIGINS",
  "BACKEND_PORT",
  "PORT",
  "TRUST_PROXY",
] as const;

beforeEach(() => {
  for (const name of URL_VARIABLES) vi.stubEnv(name, undefined);
});

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

describe("encryptionKeyProblem", () => {
  it("takes 64 hex characters, or no key", () => {
    expect(encryptionKeyProblem("0123456789abcdef".repeat(4))).toBeNull();
    expect(encryptionKeyProblem("0123456789ABCDEF".repeat(4))).toBeNull();
    expect(encryptionKeyProblem(undefined)).toBeNull();
    expect(encryptionKeyProblem("")).toBeNull();
  });

  it("names a key that would fail every sign-in's encryption", () => {
    expect(encryptionKeyProblem("not-hex")).toMatch(/64 hex characters/);
    // 64 characters, not all hex: Buffer.from would cut it short
    expect(encryptionKeyProblem(`${"0".repeat(63)}g`)).toMatch(/64 hex characters/);
    expect(encryptionKeyProblem("0".repeat(62))).toMatch(/64 hex characters/);
  });
});

describe("apiUrl and apiUrlProblem", () => {
  it("falls back to localhost while every web origin is on this machine", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BACKEND_PORT", "4010");
    expect(apiUrlProblem()).toBeNull();
    expect(apiUrl()).toBe("http://localhost:4010");

    vi.stubEnv("CLIENT_URL", "http://localhost:3000");
    vi.stubEnv(
      "EXTRA_ALLOWED_ORIGINS",
      "http://127.0.0.1:3001, http://app.localhost:3002, http://[::1]:3003",
    );
    expect(apiUrlProblem()).toBeNull();
    expect(apiUrl()).toBe("http://localhost:4010");
  });

  it("refuses the fallback for a web app on another machine, in every NODE_ENV", () => {
    vi.stubEnv("CLIENT_URL", "https://quickdraw-dev.techtree.gg");
    vi.stubEnv("PORT", "5016");
    for (const nodeEnv of ["development", "test", "production"]) {
      vi.stubEnv("NODE_ENV", nodeEnv);
      expect(apiUrlProblem()).toBe(
        "API_URL is required: CLIENT_URL is https://quickdraw-dev.techtree.gg, not this machine, " +
          "so sign-in redirects would point at http://localhost:5016. Set API_URL to the API's public URL",
      );
      expect(() => apiUrl()).toThrow(/API_URL is required/);
    }

    // a phone on the LAN cannot reach this machine's localhost either
    vi.stubEnv("CLIENT_URL", "http://192.168.80.183:3000");
    expect(apiUrlProblem()).toMatch(
      /CLIENT_URL is http:\/\/192\.168\.80\.183:3000, not this machine/,
    );
  });

  it("refuses it for an EXTRA_ALLOWED_ORIGINS entry on another machine", () => {
    vi.stubEnv("CLIENT_URL", "http://localhost:3000");
    vi.stubEnv("EXTRA_ALLOWED_ORIGINS", "http://localhost:3001,https://staging.example.com/");
    expect(apiUrlProblem()).toBe(
      "API_URL is required: EXTRA_ALLOWED_ORIGINS lists https://staging.example.com, not this " +
        "machine, so sign-in redirects would point at http://localhost:4000. Set API_URL to the API's public URL",
    );
  });

  it("takes API_URL whatever the web origins, and an empty one as unset", () => {
    vi.stubEnv("CLIENT_URL", "https://quickdraw-dev.techtree.gg");
    vi.stubEnv("API_URL", "https://quickdraw-io-dev.techtree.gg");
    expect(apiUrlProblem()).toBeNull();
    expect(apiUrl()).toBe("https://quickdraw-io-dev.techtree.gg");

    vi.stubEnv("API_URL", "");
    expect(apiUrlProblem()).toMatch(/^API_URL is required/);
  });
});

describe("trustProxyFromEnv", () => {
  it("trusts one proxy in production, as before", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_URL", "https://api.example.com");
    expect(trustProxyFromEnv()).toEqual({ value: 1, source: "production" });
  });

  it("trusts none locally", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(trustProxyFromEnv()).toEqual({ value: false, source: "default" });
    vi.stubEnv("API_URL", "http://localhost:4000");
    expect(trustProxyFromEnv()).toEqual({ value: false, source: "default" });
  });

  it("infers one proxy for a hosted instance outside production: an https API_URL", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("API_URL", "https://quickdraw-io-dev.techtree.gg");
    expect(trustProxyFromEnv()).toEqual({ value: 1, source: "API_URL" });
  });

  it("takes TRUST_PROXY over every default: a number of hops, true or false", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TRUST_PROXY", "2");
    expect(trustProxyFromEnv()).toEqual({ value: 2, source: "TRUST_PROXY" });
    vi.stubEnv("TRUST_PROXY", "false");
    expect(trustProxyFromEnv()).toEqual({ value: false, source: "TRUST_PROXY" });

    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("API_URL", "https://quickdraw-io-dev.techtree.gg");
    vi.stubEnv("TRUST_PROXY", "0");
    expect(trustProxyFromEnv()).toEqual({ value: 0, source: "TRUST_PROXY" });
    vi.stubEnv("TRUST_PROXY", " TRUE ");
    expect(trustProxyFromEnv()).toEqual({ value: true, source: "TRUST_PROXY" });
  });

  it("names a TRUST_PROXY it cannot read", () => {
    for (const value of ["yes", "loopback", "-1", "1.5", "10.0.0.0/8"]) {
      vi.stubEnv("TRUST_PROXY", value);
      expect(trustProxyFromEnv()).toEqual({
        problem: `TRUST_PROXY must be a number of proxy hops (1 behind one proxy) or true/false, not "${value}"`,
      });
    }
  });
});

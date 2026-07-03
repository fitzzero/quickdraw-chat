import { describe, it, expect } from "vitest";
import { timingSafeStringEqual } from "./timing-safe-equal.js";

describe("timingSafeStringEqual", () => {
  it("returns true for equal strings", () => {
    expect(timingSafeStringEqual("secret-value", "secret-value")).toBe(true);
  });

  it("returns false for different strings of equal length", () => {
    expect(timingSafeStringEqual("secret-value", "secret-valuX")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(timingSafeStringEqual("secret", "secret-value")).toBe(false);
  });

  it("returns false when either side is missing or empty", () => {
    expect(timingSafeStringEqual(undefined, "secret")).toBe(false);
    expect(timingSafeStringEqual("secret", undefined)).toBe(false);
    expect(timingSafeStringEqual(undefined, undefined)).toBe(false);
    expect(timingSafeStringEqual("", "")).toBe(false);
  });

  it("compares multi-byte UTF-8 correctly", () => {
    expect(timingSafeStringEqual("séçret", "séçret")).toBe(true);
    expect(timingSafeStringEqual("séçret", "secret")).toBe(false);
  });
});

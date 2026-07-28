import { describe, it, expect } from "vitest";
import { sanitizeToken } from "./sanitize-token.js";

describe("sanitizeToken", () => {
  it("passes clean ASCII tokens through unchanged", () => {
    expect(sanitizeToken("sk-ant-api03-abc_DEF-123")).toBe("sk-ant-api03-abc_DEF-123");
  });

  it("strips invisible Unicode from clipboard paste", () => {
    const zeroWidth = "sk-​abc‌‍⁠def﻿";
    expect(sanitizeToken(zeroWidth)).toBe("sk-abcdef");
    expect(sanitizeToken(" token ")).toBe("token");
  });

  it("strips whitespace and line breaks", () => {
    expect(sanitizeToken("  token\r\n")).toBe("token");
    expect(sanitizeToken("tok en\ttoo")).toBe("tokentoo");
  });

  it("throws on non-string input", () => {
    expect(() => sanitizeToken(123 as unknown as string)).toThrow("Token must be a string");
  });
});

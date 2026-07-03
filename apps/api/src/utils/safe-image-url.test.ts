import { describe, it, expect } from "vitest";
import { safeImageUrl } from "./safe-image-url.js";

describe("safeImageUrl", () => {
  it("accepts https URLs", () => {
    expect(safeImageUrl("https://lh3.googleusercontent.com/a/avatar=s96-c")).toBe(
      "https://lh3.googleusercontent.com/a/avatar=s96-c",
    );
    expect(safeImageUrl("https://cdn.discordapp.com/avatars/1/2.png")).toBe(
      "https://cdn.discordapp.com/avatars/1/2.png",
    );
  });

  it("rejects non-https schemes", () => {
    expect(safeImageUrl("http://example.com/a.png")).toBeNull();
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
    expect(safeImageUrl("data:image/png;base64,AAAA")).toBeNull();
  });

  it("rejects malformed and empty values", () => {
    expect(safeImageUrl("not a url")).toBeNull();
    expect(safeImageUrl("")).toBeNull();
    expect(safeImageUrl(null)).toBeNull();
    expect(safeImageUrl(undefined)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { generateUniqueSlug, slugify } from "./slugify.js";

describe("slugify", () => {
  it("kebab-cases text and strips symbols", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
    expect(slugify("  Multiple   spaces & symbols?! ")).toBe("multiple-spaces-symbols");
  });

  it("caps length at 60 and falls back when too short", () => {
    expect(slugify("a".repeat(80))).toHaveLength(60);
    expect(slugify("!!")).toBe("item");
  });
});

describe("generateUniqueSlug", () => {
  it("returns the base slug when free, otherwise appends a counter", async () => {
    const taken = new Set(["hello-world", "hello-world-2"]);
    const exists = async (candidate: string): Promise<boolean> => taken.has(candidate);

    expect(await generateUniqueSlug("Brand New", exists)).toBe("brand-new");
    expect(await generateUniqueSlug("Hello World", exists)).toBe("hello-world-3");
  });
});

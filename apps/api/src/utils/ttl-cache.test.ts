import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TTLCache } from "./ttl-cache.js";

describe("TTLCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns values until the TTL elapses", () => {
    const cache = new TTLCache<string>(1000);
    cache.set("key", "value");

    expect(cache.get("key")).toBe("value");
    vi.advanceTimersByTime(1001);
    expect(cache.get("key")).toBeUndefined();
  });

  it("supports per-entry TTL overrides and deletion", () => {
    const cache = new TTLCache<number>(1000);
    cache.set("long", 1, 5000);
    cache.set("short", 2);

    vi.advanceTimersByTime(2000);
    expect(cache.get("long")).toBe(1);
    expect(cache.get("short")).toBeUndefined();

    cache.delete("long");
    expect(cache.get("long")).toBeUndefined();
  });
});

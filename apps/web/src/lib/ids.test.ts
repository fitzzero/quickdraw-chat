// The ids the web makes for the rows it creates (a chat message's): version
// 4 UUIDs, on a secure page and on a plain-http one alike.

import { afterEach, describe, expect, it, vi } from "vitest";
import { newId } from "./ids";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The page's own `crypto`, before a test stubs it. */
const pageCrypto = globalThis.crypto;

/** The bytes `newId` asks `getRandomValues` for. */
type Bytes = Uint8Array<ArrayBuffer>;

/**
 * A plain-http page's `crypto`: `getRandomValues` only (random bytes, or
 * every byte `fill`), no `randomUUID`.
 */
function plainHttpCrypto(fill?: number): { getRandomValues: (array: Bytes) => Bytes } {
  return {
    getRandomValues: (array) =>
      fill === undefined ? pageCrypto.getRandomValues(array) : array.fill(fill),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("newId", () => {
  it("makes a new version 4 UUID each time", () => {
    const ids = Array.from({ length: 50 }, () => newId());
    expect(ids.every((id) => UUID_V4.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("makes one from getRandomValues on a page without randomUUID (plain http)", () => {
    vi.stubGlobal("crypto", plainHttpCrypto());
    const ids = Array.from({ length: 50 }, () => newId());
    expect(ids.every((id) => UUID_V4.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);

    // the version and variant digits, whatever the random bytes
    vi.stubGlobal("crypto", plainHttpCrypto(0xff));
    expect(newId()).toBe("ffffffff-ffff-4fff-bfff-ffffffffffff");
    vi.stubGlobal("crypto", plainHttpCrypto(0));
    expect(newId()).toBe("00000000-0000-4000-8000-000000000000");
  });
});

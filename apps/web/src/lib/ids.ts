/**
 * A new id for a row the client creates and the server keeps (a version 4
 * UUID): a send whose answer is lost can then be found by the scope's next
 * load, and sent again without writing twice. `crypto.randomUUID()`, which
 * browsers offer on secure pages only (https, localhost), else the same
 * made from `crypto.getRandomValues()`, which every page has: a dev server
 * opened at its LAN address is plain http.
 */
export function newId(): string {
  // Typed as always there, but missing on a plain-http page
  const randomUUID: (() => string) | undefined = crypto.randomUUID?.bind(crypto);
  if (randomUUID !== undefined) return randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // version 4 (random), and the RFC 9562 variant
  bytes[6] = 0x40 + ((bytes[6] ?? 0) % 0x10);
  bytes[8] = 0x80 + ((bytes[8] ?? 0) % 0x40);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

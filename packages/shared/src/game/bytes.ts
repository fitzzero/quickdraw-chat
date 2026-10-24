/**
 * Little-endian numbers in and out of a packed snapshot (snapshotCodec.ts):
 * the encoder's writer and the decoder's reader. Not exported from the
 * package.
 */

const fromUtf8 = new TextDecoder();

/** Little-endian numbers into a buffer that grows as they are written. */
export interface ByteWriter {
  u8(n: number): void;
  u16(n: number): void;
  i16(n: number): void;
  u32(n: number): void;
  f64(n: number): void;
  raw(bytes: Uint8Array): void;
  /** The bytes written. */
  done(): Uint8Array;
}

/** Little-endian numbers out of bytes, in order. */
export interface ByteReader {
  u8(): number;
  u16(): number;
  i16(): number;
  u32(): number;
  f64(): number;
  utf8(length: number): string;
}

export function byteWriter(): ByteWriter {
  let bytes = new Uint8Array(256);
  let view = new DataView(bytes.buffer);
  let at = 0;
  /** Where the next `n` bytes go, the buffer grown to hold them: call it before reading `view`. */
  const next = (n: number): number => {
    if (at + n > bytes.length) {
      const grown = new Uint8Array(Math.max(bytes.length * 2, at + n));
      grown.set(bytes);
      bytes = grown;
      view = new DataView(grown.buffer);
    }
    const start = at;
    at += n;
    return start;
  };
  return {
    u8: (n) => {
      const i = next(1);
      view.setUint8(i, n);
    },
    u16: (n) => {
      const i = next(2);
      view.setUint16(i, n, true);
    },
    i16: (n) => {
      const i = next(2);
      view.setInt16(i, n, true);
    },
    u32: (n) => {
      const i = next(4);
      view.setUint32(i, n, true);
    },
    f64: (n) => {
      const i = next(8);
      view.setFloat64(i, n, true);
    },
    raw: (data) => {
      const i = next(data.length);
      bytes.set(data, i);
    },
    done: () => bytes.slice(0, at),
  };
}

export function byteReader(bytes: Uint8Array): ByteReader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const next = (n: number): number => {
    const start = at;
    at += n;
    return start;
  };
  return {
    u8: () => view.getUint8(next(1)),
    u16: () => view.getUint16(next(2), true),
    i16: () => view.getInt16(next(2), true),
    u32: () => view.getUint32(next(4), true),
    f64: () => view.getFloat64(next(8), true),
    utf8: (length) => {
      const start = next(length);
      return fromUtf8.decode(bytes.subarray(start, start + length));
    },
  };
}

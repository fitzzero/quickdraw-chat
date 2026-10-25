import { describe, expect, it } from "vitest";
import { BodyPath, type BodySegment } from "../render/bodyPath";

const T = { segmentSpacing: 16, sampleSpacing: 8, headRadius: 10, bodyRadius: 9 };

/** A head that moved `px` to the right from the origin in `sampleSpacing` steps. */
function straight(px: number, length: number): BodyPath {
  const path = new BodyPath();
  path.reset(0, 0);
  for (let x = T.sampleSpacing; x <= px; x += T.sampleSpacing) path.advance(x, 0, length, T);
  return path;
}

describe("BodyPath", () => {
  it("places one segment every segmentSpacing px behind the head, int(length) of them", () => {
    const path = straight(400, 10.7);
    const out: BodySegment[] = [];
    const n = path.segments(400, 0, 10.7, T, out);
    expect(n).toBe(10);
    for (let i = 0; i < n; i++) {
      expect(out[i]?.x).toBeCloseTo(400 - (i + 1) * T.segmentSpacing, 5);
      expect(out[i]?.y).toBe(0);
      expect(out[i]?.index).toBe(i);
    }
  });

  it("tapers the radius from the body's to 70 % of it at the tail", () => {
    const path = straight(400, 10);
    const out: BodySegment[] = [];
    path.segments(400, 0, 10, T, out);
    expect(out[0]?.radius).toBeCloseTo(9, 5);
    expect(out[9]?.radius).toBeCloseTo(9 * (1 - 0.27), 5);
  });

  it("places fewer segments than the length while the history is short (a spawn)", () => {
    const path = straight(40, 10);
    const out: BodySegment[] = [];
    expect(path.segments(40, 0, 10, T, out)).toBe(2);
  });

  it("keeps only the history a body of its length needs", () => {
    const path = straight(4000, 10);
    expect(path.size).toBe(Math.ceil((10 * T.segmentSpacing) / T.sampleSpacing) + 4);
  });

  it("ignores head movement under sampleSpacing", () => {
    const path = new BodyPath();
    path.reset(0, 0);
    path.advance(3, 0, 10, T);
    path.advance(6, 0, 10, T);
    expect(path.size).toBe(1);
    path.advance(8, 0, 10, T);
    expect(path.size).toBe(2);
  });

  it("reuses the segment objects it is given", () => {
    const path = straight(400, 10);
    const out: BodySegment[] = [];
    path.segments(400, 0, 10, T, out);
    const first = out[0];
    path.segments(408, 0, 10, T, out);
    expect(out[0]).toBe(first);
    expect(first?.x).toBeCloseTo(392, 5);
  });
});

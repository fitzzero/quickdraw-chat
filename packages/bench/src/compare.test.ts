import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, judge } from "./compare.js";

describe("judge", () => {
  const verdict = (deltaAbs: number, base: number, floor = 1, noise = 0) =>
    judge(deltaAbs, base === 0 ? null : deltaAbs / base, floor, noise, DEFAULT_THRESHOLDS);

  it("ignores a delta within the floor, then within the noise", () => {
    expect(verdict(0.5, 10)).toBe("ok");
    expect(verdict(3, 10, 1, 4)).toBe("within-noise");
  });

  it("fails past 15%, warns past 5%, and calls a drop an improvement", () => {
    expect(verdict(2, 10)).toBe("fail");
    expect(verdict(1.2, 20)).toBe("warn");
    expect(verdict(-2, 10)).toBe("improved");
  });

  it("fails any growth past the floor from a zero baseline", () => {
    expect(verdict(1, 0)).toBe("ok");
    expect(verdict(2, 0)).toBe("fail");
  });
});

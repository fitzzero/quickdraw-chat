import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, judge, judgeZero } from "./compare.js";

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

describe("judgeZero", () => {
  it("passes only a worst run of zero, and fails a missing value", () => {
    expect(judgeZero(0)).toBe("ok");
    expect(judgeZero(2)).toBe("fail");
    // a run without the metric (NaN, null once saved), or a card without it
    expect(judgeZero(Number.NaN)).toBe("fail");
    expect(judgeZero(null)).toBe("fail");
    expect(judgeZero(undefined)).toBe("fail");
  });
});

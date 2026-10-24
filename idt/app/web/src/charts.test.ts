import { describe, expect, it } from "vitest";
import { focusDomain, niceTicks, survivalAt } from "./components/charts.tsx";
import type { CurvePoint } from "./idt.ts";

const pt = (strike: number, fitted: number): CurvePoint => ({
  strike,
  raw: fitted,
  fitted,
  bid: null,
  ask: null,
  volume: 0,
  market_ids: [],
  from_last: false,
});

const curve = [pt(70_000, 1), pt(72_000, 0.9), pt(74_000, 0.5), pt(76_000, 0.1), pt(78_000, 0)];

describe("survivalAt", () => {
  it("interpolates linearly between strikes", () => {
    expect(survivalAt(curve, 73_000)).toBeCloseTo(0.7);
  });

  it("refuses to extrapolate outside the strike grid", () => {
    expect(survivalAt(curve, 69_999)).toBeNull();
    expect(survivalAt(curve, 78_001)).toBeNull();
  });
});

describe("focusDomain", () => {
  it("frames the strikes where the curve is still moving, with padding", () => {
    const [lo, hi] = focusDomain([{ venue: "v", label: "V", color: "#000", points: curve }]);
    expect(lo).toBeLessThan(72_000);
    expect(lo).toBeGreaterThan(70_000);
    expect(hi).toBeGreaterThan(76_000);
    expect(hi).toBeLessThan(78_000);
  });
});

describe("niceTicks", () => {
  it("steps on 1/2/2.5/5 multiples inside the range", () => {
    expect(niceTicks(71_300, 88_900, 4)).toEqual([75_000, 80_000, 85_000]);
    expect(niceTicks(0, 0.12, 2)).toEqual([0, 0.1]);
  });
});

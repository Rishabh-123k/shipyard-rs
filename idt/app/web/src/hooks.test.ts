import { describe, expect, it } from "vitest";
import { settlementState } from "./hooks.ts";

const base = { signing: false, startedAt: 1_000, status: undefined, terminal: ["complete", "failed"], success: "complete", now: 2_000 };

describe("settlementState", () => {
  it("reports signing while execute is in flight", () => {
    expect(settlementState({ ...base, signing: true, startedAt: null })).toBe("signing");
  });

  it("is idle before anything was executed", () => {
    expect(settlementState({ ...base, startedAt: null })).toBeNull();
  });

  it("maps terminal statuses to success or failure", () => {
    expect(settlementState({ ...base, status: "complete" })).toBe("succeeded");
    expect(settlementState({ ...base, status: "failed" })).toBe("failed");
  });

  it("stays pending inside the timeout", () => {
    expect(settlementState({ ...base, status: "pending", now: 1_000 + 60_000 })).toBe("pending");
  });

  it("times out on the wall clock even when no poll ever succeeded", () => {
    expect(settlementState({ ...base, status: undefined, now: 1_000 + 60_001 })).toBe("timed_out");
  });
});

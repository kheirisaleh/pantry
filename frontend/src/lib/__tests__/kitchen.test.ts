import { describe, expect, it } from "vitest";
import { barLabel, cycleMessage, easeOut, lastCycleText, reelOffset, tierChip, wrapIndex } from "../kitchen";
import type { Cycle, CycleStatus } from "../types";

const cycle: Cycle = {
  start: "2026-10-19", planned_days: 7, planned_end: "2026-10-26", elapsed_days: 2, progress: 0.3, forecast_run_out: "2026-10-24",
  difference_days: -2, spend: 42, daily_spend: 6, extra_days_so_far: 0, saved_so_far: 0, projected_saving: 0, projected_extra_cost: 12, state: "early",
};

function status(over: Partial<Cycle> = {}, history: CycleStatus["history"] = []): CycleStatus {
  return { today: "2026-10-21", default_days: 7, history, cookable_now: 2, meals_left: 4, must_shop: false, empty_pantry: false, cycle: { ...cycle, ...over } };
}

describe("kitchen", () => {
  it("labels suggestion tiers", () => {
    expect(tierChip({ tier: 0, shortages: [] })).toEqual({ tone: "good", text: "ready to cook" });
    expect(tierChip({ tier: 1, shortages: [] }).tone).toBe("warn");
    expect(tierChip({ tier: 2, shortages: [{ ingredient_id: 1, display: "x", icon: null, missing: 1, unit: "g" }] }).text).toBe("needs 1 items");
  });

  it("explains the shopping cycle", () => {
    expect(cycleMessage(status())?.[0]).toBe("Runs out early");
    expect(cycleMessage(status())?.[1]).toContain("2 days before the plan ends");
    expect(cycleMessage(status({ state: "ahead", difference_days: 3, projected_saving: 0 }))?.[1]).toContain("about 3 days more than planned.");
    expect(cycleMessage(status({ state: "on_track" }))?.[0]).toBe("On track");
    expect(cycleMessage(status({ state: "extended", extra_days_so_far: 2, saved_so_far: 0 }))?.[1]).toBe("2 days past the plan and you can still cook.");
    expect(cycleMessage({ ...status(), cycle: null })).toBeNull();
  });

  it("summarises the last finished cycle", () => {
    expect(lastCycleText(status())).toBeNull();
    const history = [{ list_id: 1, trip: "2026-10-01", planned_days: 7, actual_days: 9, spend: 70, saved: 20 }];
    expect(lastCycleText(status({}, history))).toMatch(/^Last time: planned 7 days, lasted 9, saved 20,00\s€$/);
  });

  it("does carousel and chart maths", () => {
    expect(reelOffset(0, 0, 5)).toBe(0);
    expect(reelOffset(4, 0, 5)).toBe(-1);
    expect(reelOffset(1, 4, 5)).toBe(2);
    expect(wrapIndex(-1, 5)).toBe(4);
    expect(wrapIndex(5, 5)).toBe(0);
    expect(barLabel(1540, 0)).toBe("1.5k");
    expect(barLabel(0, 900)).toBe("~0.9k");
    expect(barLabel(48, 0)).toBe("48");
    expect(barLabel(0, 0)).toBe("");
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { type Countable, countEntries, countEntry, countUnits, initialDraft, knownSize, needsSize } from "../count";

function tuna(over: Partial<Countable> = {}): Countable {
  return { id: 7, unit: "g", stock: 300, piece_amount: null, package_amount: null, package_estimate: 150, ...over };
}

describe("pantry count", () => {
  it("offers units that make sense for the base unit", () => {
    expect(countUnits("g")).toEqual(["g", "kg", "pcs", "pack"]);
    expect(countUnits("ml")).toEqual(["ml", "l", "pcs", "pack"]);
    expect(countUnits("pcs")).toEqual(["pcs", "pack"]);
    expect(needsSize("g", "pack")).toBe(true);
    expect(needsSize("g", "pcs")).toBe(true);
    expect(needsSize("pcs", "pcs")).toBe(false);
    expect(needsSize("g", "kg")).toBe(false);
    expect(knownSize(tuna({ package_amount: 185 }), "pack")).toBe(185);
  });

  it("starts from what is known", () => {
    expect(initialDraft(tuna(), null)).toEqual({ amount: "300", unit: "g", size: "" });
    expect(initialDraft(tuna({ package_amount: 150 }), "pack")).toEqual({ amount: "2", unit: "pack", size: "150" });
    expect(initialDraft(tuna(), "pack")).toEqual({ amount: "300", unit: "g", size: "" });
    expect(initialDraft(tuna({ stock: 1500 }), "kg")).toEqual({ amount: "1.5", unit: "kg", size: "" });
    expect(initialDraft(tuna({ stock: 0, pending_stock: [{ unit: "pack", qty: 4 }] }), null)).toEqual({ amount: "4", unit: "pack", size: "" });
  });

  it("sends only real changes and the size when it is new", () => {
    const item = tuna();
    const start = initialDraft(item, null);
    expect(countEntry(item, start, start)).toEqual({});
    expect(countEntry(item, start, { ...start, amount: "300,0" })).toEqual({});
    expect(countEntry(item, start, { ...start, amount: "250" })).toEqual({ entry: { ingredient_id: 7, qty: 250, unit: "g" } });
    expect(countEntry(item, start, { amount: "4", unit: "pack", size: "" })).toEqual({ entry: { ingredient_id: 7, qty: 4, unit: "pack" } });
    expect(countEntry(item, start, { amount: "4", unit: "pack", size: "150" })).toEqual({ entry: { ingredient_id: 7, qty: 4, unit: "pack", size: 150 } });
    const known = tuna({ package_amount: 150 });
    expect(countEntry(known, start, { amount: "4", unit: "pack", size: "150" })).toEqual({ entry: { ingredient_id: 7, qty: 4, unit: "pack" } });
  });

  it("refuses text that is not a number", () => {
    const item = tuna();
    const start = initialDraft(item, null);
    expect(countEntry(item, start, { ...start, amount: "1,5kg" }).error).toBeDefined();
    expect(countEntry(item, start, { amount: "4", unit: "pack", size: "0" }).error).toBeDefined();
    const result = countEntries([item, tuna({ id: 8 })], { 7: start, 8: start }, { 7: { ...start, amount: "200" }, 8: { ...start, amount: "x" } });
    expect(result.entries).toEqual([]);
    expect(result.error).toBeDefined();
  });
});

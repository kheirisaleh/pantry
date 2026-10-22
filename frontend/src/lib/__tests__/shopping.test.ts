import { describe, expect, it } from "vitest";
import { amountHint, closeListMessage, defaultPriceMode, defaultSize, defaultUnit, emptyList, grouped, lineTotal, needsSize, needText, perLabel, placeholderIngredient, priceText, sessionCount, sessionTotal } from "../shopping";
import type { ShoppingItem } from "../types";

function item(over: Partial<ShoppingItem> = {}, ingredient: Partial<ShoppingItem["ingredient"]> = {}): ShoppingItem {
  return { id: 1, auto: 1, needed_qty: 500, checked: 0, bought_qty: null, price: null, session_id: null, committed: 0, ingredient: { ...placeholderIngredient("Rice"), ...ingredient }, ...over };
}

describe("shopping", () => {
  it("guesses the unit people buy in", () => {
    expect(defaultUnit(item())).toBe("g");
    expect(defaultUnit(item({ needed_qty: 1500 }))).toBe("kg");
    expect(defaultUnit(item({ needed_qty: 1500 }, { unit: "ml" }))).toBe("l");
    expect(defaultUnit(item({ packages: 2 }))).toBe("pack");
    expect(defaultUnit(item({ pieces: 2 }))).toBe("pcs");
    expect(defaultUnit(item({ needed_qty: null }))).toBe("pcs");
    expect(defaultUnit(item({}, { kind: "household" }))).toBe("pcs");
    expect(defaultUnit(item({ bought_unit: "kg" }))).toBe("kg");
  });

  it("hints the amount in the chosen unit", () => {
    expect(amountHint(item({ needed_qty: 1500 }), "kg")).toBe("1.5");
    expect(amountHint(item(), "g")).toBe("500");
    expect(amountHint(item({ packages: 3 }), "pack")).toBe("3");
    expect(amountHint(item(), "pack")).toBe("1");
    expect(amountHint(item({ pieces: 2 }), "pcs")).toBe("2");
    expect(amountHint(item({ needed_qty: 6 }, { unit: "pcs" }), "pcs")).toBe("6");
    expect(amountHint(item({ needed_qty: null }), "g")).toBe("");
  });

  it("describes what is needed", () => {
    expect(needText(item())).toBe("500 g");
    expect(needText(item({ packages: 1 }))).toBe("1 pack, 500 g");
    expect(needText(item({ pieces: 2, needed_qty: 600 }))).toBe("2 pcs, about 600 g");
    expect(needText(item({ needed_qty: null }))).toBeNull();
  });

  it("totals a trip", () => {
    const list = { ...emptyList(), items: [item({ checked: 1, price: 2.5, session_id: 4 }), item({ checked: 1, price: 1, session_id: "tmp-s-1" }), item({ price: 9 })] };
    expect(sessionTotal(list)).toBe(3.5);
    expect(sessionTotal(list, 4)).toBe(2.5);
    expect(sessionTotal(list, "tmp-s-1")).toBe(1);
    expect(sessionTotal(null)).toBe(0);
    expect(sessionCount(list, 4)).toBe(1);
  });

  it("groups by category in order", () => {
    expect(grouped([{ c: "a" }, { c: "a" }, { c: "b" }, { c: "a" }], (entry) => entry.c).map((group) => [group.category, group.items.length])).toEqual([["a", 2], ["b", 1], ["a", 1]]);
  });

  it("words the close dialog", () => {
    expect(closeListMessage({ ...emptyList(), items: [item(), item()] })).toMatch(/^2 items were not bought/);
    expect(closeListMessage({ ...emptyList(), items: [item()] })).toMatch(/^1 item was not bought/);
    expect(closeListMessage(emptyList())).toBe("Ticked items go into the pantry.");
    expect(priceText(2.5)).toBe("2,5");
    expect(priceText(null)).toBe("");
  });
  it("multiplies a price each by the count and reads weights per kilo", () => {
    expect(lineTotal(1.29, 3, "pcs")).toBe(3.87);
    expect(lineTotal(4.99, null, "pack")).toBe(4.99);
    expect(lineTotal(6, 500, "g")).toBe(3);
    expect(lineTotal(2.5, 1.5, "kg")).toBe(3.75);
    expect(lineTotal(null, 3, "pcs")).toBeNull();
    expect(perLabel("pack")).toBe("/pack");
    expect(perLabel("g")).toBe("/kg");
    expect(perLabel("ml")).toBe("/l");
  });

  it("picks price mode and pack size from what is known", () => {
    expect(defaultPriceMode(item(), "pack")).toBe("each");
    expect(defaultPriceMode(item(), "g")).toBe("total");
    expect(defaultPriceMode(item({ price: 2 }), "pack")).toBe("total");
    expect(defaultPriceMode(item({ unit_price: 1, price: 3 }), "g")).toBe("each");
    expect(needsSize(item(), "pack")).toBe(true);
    expect(needsSize(item(), "pcs")).toBe(true);
    expect(needsSize(item({}, { unit: "pcs" }), "pcs")).toBe(false);
    expect(needsSize(item(), "kg")).toBe(false);
    expect(defaultSize(item({}, { package_amount: 800 }), "pack")).toBe(800);
    expect(defaultSize(item({ pack_size: 600 }, { package_amount: 800 }), "pack")).toBe(600);
    expect(defaultSize(item({}, { piece_amount: 120 }), "pcs")).toBe(120);
    expect(defaultSize(item(), "g")).toBeNull();
  });
});

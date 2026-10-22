import { describe, expect, it } from "vitest";
import type { CalendarDay, InventoryItem, Meal } from "@/lib/types";
import { countChanges } from "../buildList";
import { countable } from "../count";
import { detailsPayload } from "../ingredient";
import { moveMeal } from "../planDrag";
import { draftItem, recipePayload } from "../recipeEditor";
import { moveUp } from "../settings";

function meal(id: number, date: string): Meal {
  return { id, date, position: 0, recipe_id: 1, servings: 2, status: "planned", choices: {}, optional_items: [], cooked_by: null, cooked_at: null, cost: null, kcal: null, protein: null, source: "app", recipe: null };
}

describe("feature logic", () => {
  it("moves meals between days for an optimistic redraw", () => {
    const days: CalendarDay[] = [
      { date: "2026-10-21", meals: [meal(1, "2026-10-21"), meal(2, "2026-10-21")], snacks: [] },
      { date: "2026-10-22", meals: [meal(3, "2026-10-22")], snacks: [] },
    ];
    const moved = moveMeal(days, 1, "2026-10-22", 1);
    expect(moved[0]?.meals.map((entry) => entry.id)).toEqual([2]);
    expect(moved[1]?.meals.map((entry) => [entry.id, entry.date])).toEqual([[3, "2026-10-22"], [1, "2026-10-22"]]);
    expect(moveMeal(days, 2, "2026-10-21", 0)[0]?.meals.map((entry) => entry.id)).toEqual([2, 1]);
    expect(moveMeal(days, 99, "2026-10-21", 0)).toBe(days);
  });

  it("checks a dish before saving", () => {
    const rice = draftItem({ name: "berenj" }, true);
    expect(recipePayload("  ", [])).toEqual({ error: "Give the dish a name" });
    expect(recipePayload("polo", [])).toEqual({ error: "Add at least one ingredient" });
    expect(recipePayload("polo", [{ key: 1, optional: false, items: [rice] }])).toEqual({ error: "Every ingredient needs an amount" });
    const result = recipePayload(" polo ", [{ key: 1, optional: true, items: [{ ...rice, amount: "1,5", per_dish: true }] }]);
    expect(result).toEqual({ payload: { name: "polo", slots: [{ optional: true, items: [{ ingredient_id: undefined, name: "berenj", amount: 1.5, unit: "g", is_default: true, per_dish: true }] }] } });
  });

  it("only sends counts that changed", () => {
    const lines = [{ ingredient_id: 1, stock: 500 }, { ingredient_id: 2, stock: 3 }, { ingredient_id: 3, stock: 0 }];
    expect(countChanges(lines, { 1: "500", 2: "1,5", 3: "" })).toEqual([{ ingredient_id: 2, qty: 1.5 }]);
  });

  it("lists what a pantry check covers", () => {
    const item = (kind: string, stock: number) => ({ kind, stock }) as InventoryItem;
    expect(countable([item("food", 0), item("staple", 5), item("snack", 0), item("snack", 2)]).map((entry) => entry.kind)).toEqual(["food", "snack"]);
  });

  it("builds the ingredient edit payload", () => {
    const payload = detailsPayload({ name_en: " Rice ", kcal: "350,5", sold_by_piece: "1", name_fa: "" }, [
      { key: "name_en", label: "", kind: "text" },
      { key: "kcal", label: "", kind: "number" },
      { key: "sold_by_piece", label: "", kind: "check" },
      { key: "name_fa", label: "", kind: "text" },
    ]);
    expect(payload).toEqual({ name_en: "Rice", kcal: 350.5, sold_by_piece: 1, name_fa: null });
  });

  it("reorders models", () => {
    expect(moveUp(["a", "b", "c"], 2)).toEqual(["a", "c", "b"]);
    expect(moveUp(["a", "b"], 0)).toEqual(["a", "b"]);
  });
});

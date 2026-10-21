import { describe, expect, it } from "vitest";
import type { InventoryItem, Recipe } from "@/lib/types";
import { shownItems } from "../Pantry";
import { matchesRecipe } from "../Recipes";

describe("page filters", () => {
  it("shows pantry items per tab", () => {
    const item = (id: number, kind: string, stock: number, pending = 0) => ({ id, kind, stock, pending_stock: pending ? [{ unit: "pcs", qty: pending }] : [] }) as InventoryItem;
    const items = [item(1, "food", 100), item(2, "food", 0), item(3, "food", 0, 2), item(4, "snack", 1), item(5, "staple", 0)];
    expect(shownItems(items, "food").map((entry) => entry.id)).toEqual([1, 3]);
    expect(shownItems(items, "snack").map((entry) => entry.id)).toEqual([4]);
    expect(shownItems(items, "all")).toHaveLength(5);
  });

  it("finds dishes by any name or tag", () => {
    const recipe = { display: "Loobia Polo", name_fa: "لوبیا پلو", raw_name: "loobia polo", tags: ["persian", "rice"] } as Recipe;
    expect(matchesRecipe(recipe, "")).toBe(true);
    expect(matchesRecipe(recipe, "RICE")).toBe(true);
    expect(matchesRecipe(recipe, "لوبیا")).toBe(true);
    expect(matchesRecipe(recipe, "pizza")).toBe(false);
  });
});

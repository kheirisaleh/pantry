import { money, qty, trim } from "./format";
import type { Id, IngredientRef, ShopUnit, ShoppingItem, ShoppingList } from "./types";

export function defaultUnit(item: ShoppingItem): ShopUnit {
  const ingredient = item.ingredient;
  if (item.bought_unit) return item.bought_unit;
  if (item.packages) return "pack";
  if (item.pieces || ingredient.unit === "pcs" || ingredient.kind === "household" || !item.needed_qty) return "pcs";
  if (ingredient.unit === "g" && item.needed_qty >= 1000) return "kg";
  if (ingredient.unit === "ml" && item.needed_qty >= 1000) return "l";
  return ingredient.unit;
}

export function amountHint(item: ShoppingItem, unit: ShopUnit): string {
  if (unit === "pack") return item.packages ? String(item.packages) : "1";
  if (unit === "pcs") return item.pieces ? String(item.pieces) : item.ingredient.unit === "pcs" && item.needed_qty ? trim(item.needed_qty, 0) : "1";
  if (!item.needed_qty) return "";
  if (unit === "kg" || unit === "l") return trim(item.needed_qty / 1000, 2);
  return trim(item.needed_qty, 0);
}

export function needText(item: ShoppingItem): string | null {
  const unit = item.ingredient.unit;
  if (item.packages) return String(item.packages) + " pack" + (item.packages === 1 ? "" : "s") + ", " + qty(item.needed_qty, unit);
  if (item.pieces) return String(item.pieces) + " pcs, about " + qty(item.needed_qty, unit);
  if (item.needed_qty) return qty(item.needed_qty, unit);
  return null;
}

export function sessionTotal(list: ShoppingList | null, sessionId?: Id | null): number {
  if (!list) return 0;
  return list.items
    .filter((item) => item.checked && (sessionId === undefined || sessionId === null || String(item.session_id) === String(sessionId)))
    .reduce((sum, item) => sum + (Number(item.price) || 0), 0);
}

export function sessionCount(list: ShoppingList, sessionId: Id): number {
  return list.items.filter((item) => item.checked && !item.committed && String(item.session_id) === String(sessionId)).length;
}

export function grouped<T>(items: T[], category: (item: T) => string): { category: string; items: T[] }[] {
  const groups: { category: string; items: T[] }[] = [];
  for (const item of items) {
    const key = category(item);
    const last = groups[groups.length - 1];
    if (last?.category === key) last.items.push(item);
    else groups.push({ category: key, items: [item] });
  }
  return groups;
}

export function emptyList(): ShoppingList {
  return { id: null, status: "open", items: [], sessions: [], active_session: null };
}

export function placeholderIngredient(name: string): IngredientRef {
  return { id: 0, raw_name: name, name_en: null, name_fa: null, name_de: null, icon: null, category: "other", kind: "food", unit: "g", status: "pending", piece_amount: null, package_amount: null, display: name };
}

export function closeListMessage(list: ShoppingList): string {
  const remaining = list.items.filter((item) => !item.committed && !item.checked).length;
  const prefix = remaining
    ? String(remaining) + " item" + (remaining === 1 ? " was" : "s were") + " not bought and will be removed. You will get a note for any planned dish that now lacks something. "
    : "";
  return prefix + "Ticked items go into the pantry.";
}

export function priceText(value: number | null | undefined): string {
  return value !== null && value !== undefined ? String(value).replace(".", ",") : "";
}

export function sessionLabel(store: string, count: number, total: number): string {
  return "At " + store + ", " + String(count) + " item" + (count === 1 ? "" : "s") + " " + money(total);
}

export type PriceMode = "each" | "total";

export function needsSize(item: ShoppingItem, unit: ShopUnit): boolean {
  return unit === "pack" || (unit === "pcs" && item.ingredient.unit !== "pcs");
}

export function defaultSize(item: ShoppingItem, unit: ShopUnit): number | null {
  if (!needsSize(item, unit)) return null;
  if (item.pack_size) return item.pack_size;
  return (unit === "pack" ? item.ingredient.package_amount : item.ingredient.piece_amount) || null;
}

export function defaultPriceMode(item: ShoppingItem, unit: ShopUnit): PriceMode {
  if (item.unit_price !== null && item.unit_price !== undefined) return "each";
  if (item.price !== null && item.price !== undefined) return "total";
  return unit === "pack" || unit === "pcs" ? "each" : "total";
}

export function perLabel(unit: ShopUnit): string {
  if (unit === "pack") return "/pack";
  if (unit === "pcs") return "/pc";
  if (unit === "ml" || unit === "l") return "/l";
  return "/kg";
}

export function lineTotal(unitPrice: number | null, amount: number | null, unit: ShopUnit): number | null {
  if (unitPrice === null) return null;
  let count = amount || 1;
  if (unit === "g" || unit === "ml") count = count / 1000;
  return Math.round(unitPrice * count * 100) / 100;
}

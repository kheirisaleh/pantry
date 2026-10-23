import { parseNumber, trim } from "./format";
import { storageGet, storageSet } from "./storage";
import type { ShopUnit, Unit } from "./types";

export interface Countable {
  id: number;
  unit: Unit;
  stock: number;
  piece_amount: number | null;
  package_amount: number | null;
  package_estimate?: number | null;
  pending_stock?: { unit: string; qty: number }[];
}

export interface CountDraft {
  amount: string;
  unit: ShopUnit;
  size: string;
}

export interface CountEntry {
  ingredient_id: number;
  qty: number;
  unit: ShopUnit;
  size?: number;
}

export function countUnits(base: Unit): ShopUnit[] {
  if (base === "pcs") return ["pcs", "pack"];
  if (base === "ml") return ["ml", "l", "pcs", "pack"];
  return ["g", "kg", "pcs", "pack"];
}

export function needsSize(base: Unit, unit: ShopUnit): boolean {
  return unit === "pack" || (unit === "pcs" && base !== "pcs");
}

export function knownSize(item: Countable, unit: ShopUnit): number | null {
  if (!needsSize(item.unit, unit)) return null;
  return (unit === "pack" ? item.package_amount : item.piece_amount) || null;
}

export function estimatedSize(item: Countable, unit: ShopUnit): number | null {
  return unit === "pack" && !item.package_amount ? item.package_estimate || null : null;
}

function factor(item: Countable, unit: ShopUnit): number | null {
  if (unit === item.unit) return 1;
  if (unit === "kg" || unit === "l") return 1000;
  return knownSize(item, unit);
}

export function preferredUnit(id: number): ShopUnit | null {
  return storageGet<ShopUnit | null>("count-unit:" + String(id), null);
}

export function rememberUnit(id: number, unit: ShopUnit): void {
  storageSet("count-unit:" + String(id), unit);
}

export function initialDraft(item: Countable, preferred: ShopUnit | null = preferredUnit(item.id)): CountDraft {
  const units = countUnits(item.unit);
  const waiting = item.stock > 0 ? [] : (item.pending_stock ?? []);
  const pending = waiting.length === 1 ? waiting[0] : undefined;
  if (pending && units.includes(pending.unit as ShopUnit)) {
    const unit = pending.unit as ShopUnit;
    const size = knownSize(item, unit);
    return { amount: trim(pending.qty, 2), unit, size: size ? trim(size, 1) : "" };
  }
  if (preferred && preferred !== item.unit && units.includes(preferred)) {
    const scale = factor(item, preferred);
    if (scale) {
      const size = knownSize(item, preferred);
      return { amount: trim(item.stock / scale, 2), unit: preferred, size: size ? trim(size, 1) : "" };
    }
  }
  return { amount: trim(item.stock, 1), unit: item.unit, size: "" };
}

export function countEntry(item: Countable, initial: CountDraft, draft: CountDraft): { entry?: CountEntry; error?: string } {
  const sized = needsSize(item.unit, draft.unit);
  if (draft.amount === initial.amount && draft.unit === initial.unit && (!sized || draft.size === initial.size)) return {};
  if (!draft.amount.trim()) return {};
  const qty = parseNumber(draft.amount);
  if (qty === null || qty < 0) return { error: "Check the amount of every item, one of them is not a number" };
  const entry: CountEntry = { ingredient_id: item.id, qty, unit: draft.unit };
  if (sized && draft.size.trim()) {
    const size = parseNumber(draft.size);
    if (size === null || size <= 0) return { error: "A pack or piece size must be a number above zero" };
    if (size !== knownSize(item, draft.unit)) entry.size = size;
  }
  if (draft.unit === item.unit && !item.pending_stock?.length && Math.abs(qty - item.stock) <= 0.01) return {};
  return { entry };
}

export function countEntries(items: Countable[], initial: Record<number, CountDraft>, drafts: Record<number, CountDraft>): { entries: CountEntry[]; error?: string } {
  const entries: CountEntry[] = [];
  for (const item of items) {
    const draft = drafts[item.id];
    const start = initial[item.id];
    if (!draft || !start) continue;
    const result = countEntry(item, start, draft);
    if (result.error) return { entries: [], error: result.error };
    if (result.entry) entries.push(result.entry);
  }
  return { entries };
}

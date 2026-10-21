import type { Named } from "./types";

export const UNIT_LABELS: Record<string, string> = { g: "g", ml: "ml", pcs: "pcs", jar: "jar", can: "can", pack: "pack", tbsp: "tbsp", tsp: "tsp" };
export const RECIPE_UNITS = ["g", "ml", "pcs", "jar", "can", "pack", "tbsp", "tsp"] as const;
export const SHOP_UNITS = ["g", "kg", "ml", "l", "pcs", "pack"] as const;
export const BASE_UNITS = ["g", "ml", "pcs"] as const;

export function trim(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

export function qty(value: number | null | undefined, unit: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const number = value;
  if (unit === "pcs") return trim(number, number < 10 ? 1 : 0) + " pcs";
  if (unit && UNIT_LABELS[unit] && unit !== "g" && unit !== "ml") return trim(number, 1) + " " + (UNIT_LABELS[unit] ?? unit);
  if (number >= 1000) return trim(number / 1000, 2) + (unit === "g" ? " kg" : " l");
  return trim(number, number < 10 ? 1 : 0) + " " + (unit ?? "");
}

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

export function money(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  return euro.format(Number(value));
}

export function parseNumber(text: string | number | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const cleaned = String(text).trim().replace(/\s/g, "").replace(",", ".");
  if (!cleaned) return null;
  const number = Number(cleaned);
  return Number.isFinite(number) ? number : null;
}

export function iso(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function fromIso(text: string): Date {
  const [year = 1970, month = 1, day = 1] = text.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function addDays(text: string, days: number): string {
  const date = fromIso(text);
  date.setDate(date.getDate() + days);
  return iso(date);
}

export function monday(text: string): string {
  const date = fromIso(text);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return iso(date);
}

export function dayLabel(text: string, today: string, style?: Intl.DateTimeFormatOptions): string {
  if (text === today) return "Today";
  if (text === addDays(today, 1)) return "Tomorrow";
  if (text === addDays(today, -1)) return "Yesterday";
  return fromIso(text).toLocaleDateString("en-GB", style ?? { weekday: "short", day: "numeric", month: "short" });
}

export function shortDate(text: string): string {
  return fromIso(text.slice(0, 10)).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function weekday(text: string, style: "short" | "long" | "narrow" = "short"): string {
  return fromIso(text).toLocaleDateString("en-GB", { weekday: style });
}

export function longDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export function displayName(entity: Named): string {
  return entity.display || entity.name_en || entity.raw_name || entity.name || "?";
}

export function plural(count: number, word: string, many?: string): string {
  return String(count) + " " + (count === 1 ? word : (many ?? word + "s"));
}

export function greeting(hour: number): string {
  return hour < 11 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

export function durationLabel(seconds: number): string {
  return seconds >= 3600 ? String(Math.floor(seconds / 3600)) + " h " + String(Math.ceil((seconds % 3600) / 60)) + " min" : String(Math.ceil(seconds / 60)) + " min";
}

export function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

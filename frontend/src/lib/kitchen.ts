import { money, shortDate } from "./format";
import type { CycleStatus, Suggestion } from "./types";

export const TIER_TITLES = ["Ready to cook", "Possible, but takes from a later planned dish", "Missing something"] as const;

export function tierChip(entry: Pick<Suggestion, "tier" | "shortages">): { tone: "good" | "warn" | ""; text: string } {
  if (entry.tier === 0) return { tone: "good", text: "ready to cook" };
  if (entry.tier === 1) return { tone: "warn", text: "uses stock of another dish" };
  return { tone: "", text: "needs " + String(entry.shortages.length) + " items" };
}

export function cycleMessage(state: CycleStatus): [string, string] | null {
  const cycle = state.cycle;
  if (!cycle) return null;
  const messages: Record<string, [string, string]> = {
    on_track: ["On track", "At this pace the food lasts the planned " + String(cycle.planned_days) + " days."],
    ahead: [
      "Lasting longer",
      "At this pace the food lasts until " + shortDate(cycle.forecast_run_out) + ", about " + String(cycle.difference_days) + " days more than planned" +
        (cycle.projected_saving ? ", worth about " + money(cycle.projected_saving) + "." : "."),
    ],
    early: [
      "Runs out early",
      "At this pace the food runs out around " + shortDate(cycle.forecast_run_out) + ", " + String(Math.abs(cycle.difference_days)) + " days before the plan ends" +
        (cycle.projected_extra_cost ? ". That is about " + money(cycle.projected_extra_cost) + " of extra shopping." : "."),
    ],
    extended: [
      "Well done",
      String(cycle.extra_days_so_far) + " days past the plan and you can still cook" + (cycle.saved_so_far ? ". You saved about " + money(cycle.saved_so_far) + " so far." : "."),
    ],
  };
  return messages[cycle.state] ?? messages.on_track ?? null;
}

export function lastCycleText(state: CycleStatus): string | null {
  const last = state.history.filter((entry) => entry.actual_days !== null).slice(-1)[0];
  if (!last) return null;
  return (
    "Last time: planned " + String(last.planned_days) + " days, lasted " + String(last.actual_days) +
    (last.saved ? ", saved " + money(last.saved) : last.extra_cost ? ", " + money(last.extra_cost) + " extra" : "")
  );
}

export function reelOffset(position: number, index: number, length: number): number {
  let offset = position - index;
  const half = length / 2;
  if (offset > half) offset -= length;
  if (offset < -half) offset += length;
  return offset;
}

export function wrapIndex(target: number, length: number): number {
  return ((target % length) + length) % length;
}

export function barLabel(eaten: number, planned: number): string {
  const short = (value: number) => (value < 100 ? String(Math.round(value)) : (value / 1000).toFixed(1) + "k");
  if (eaten) return short(eaten);
  if (planned) return "~" + short(planned);
  return "";
}

export function easeOut(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

import { vi } from "vitest";
import type { Alert, Boot, CalendarDay, CycleStatus, Integrations, Inventory, Recipe, ShoppingList, Suggestions, WeekSummary } from "@/lib/types";

export const boot: Boot = {
  users: [{ id: 1, name: "Leila", color: "#f2a93b" }],
  ai: { enabled: true, key_source: null, key_hint: null, models: [], key_set: false, model: "gemini", queued: 0, last_error: null, last_ok: null, cooldown_seconds: 0 },
  alerts: 1,
  vapid: "AQID",
  today: "2026-10-21",
  default_servings: 2,
  alexa_skill_id: "",
  alexa_endpoint: "/alexa",
  categories: ["vegetables", "grains", "other"],
  icons: ["egg"],
  stores: ["Rewe"],
};

const ingredient = { id: 1, raw_name: "berenj", name_en: "Basmati rice", name_fa: "برنج", name_de: "Basmatireis", icon: "cooked-rice", category: "grains", kind: "food" as const, unit: "g" as const, status: "ready" as const, piece_amount: null, package_amount: null, display: "Basmati rice" };

export const recipe: Recipe = {
  id: 7, raw_name: "adas polo", name_en: "Adas Polo", name_fa: "عدس پلو", name_de: null, description: null, tags: ["persian"], cook_minutes: 50, image_path: null, image_candidates: [],
  image_status: "none", status: "ready", ai_error: null, archived: 0, display: "Adas Polo",
  slots: [{ slot: 0, items: [{ id: 70, recipe_id: 7, slot: 0, ingredient_id: 1, amount: 80, unit: "g", optional: 0, is_default: 1, position: 0, per_dish: 0, ingredient }] }],
  nutrition_per_person: { kcal: 543, protein: 20, fat: 3, carbs: 70, fiber: 4 }, nutrition_complete: true, last_cooked: null,
};

const calendar: CalendarDay[] = [
  { date: "2026-10-21", meals: [{ id: 3, date: "2026-10-21", position: 0, recipe_id: 7, servings: 2, status: "planned", choices: {}, optional_items: [], cooked_by: null, cooked_at: null, cost: null, kcal: null, protein: null, source: "alexa", recipe: { id: 7, display: "Adas Polo", name_fa: null, image_path: null, archived: 0 }, feasible: true, shortages: [] }], snacks: [] },
  { date: "2026-10-22", meals: [], snacks: [] },
  { date: "2026-10-23", meals: [], snacks: [] },
];

const suggestions: Suggestions = { servings: 2, suggestions: [{ recipe_id: 7, name: "Adas Polo", name_fa: "عدس پلو", image_path: null, tier: 0, breaks: 0, last_cooked: null, planned_here: true, pool_meal_id: 3, shortages: [] }] };
const alerts: Alert[] = [{ id: 5, kind: "missing", title: "Not enough Basmati rice for Adas Polo", body: "Planned for 2026-10-22.", payload: { ingredient_id: 1 }, status: "open", created_at: "2026-10-21 08:00:00" }];
const shopping: ShoppingList = { id: 2, status: "open", range_start: "2026-10-21", range_end: "2026-10-27", items: [{ id: 9, auto: 1, needed_qty: 160, checked: 0, bought_qty: null, price: null, session_id: null, committed: 0, ingredient }], sessions: [], active_session: null };
const inventory: Inventory = { last_count: null, items: [{ ...ingredient, sold_by_piece: 0, kcal: 350, protein: 7, fat: 1, carbs: 78, fiber: 1, tolerance_pct: 0, unit_locked: 1, shelf_days: 365, ai_error: null, archived: 0, stock: 1500, aliases: [], pending_stock: [], batches: [], expiring_estimate: null }] };
const week: WeekSummary = { start: "2026-10-19", users: ["Leila"], average_kcal: 1800, average_planned_kcal: 900, days: ["19", "20", "21", "22", "23", "24", "25"].map((day) => ({ date: "2026-10-" + day, is_today: day === "21", is_future: day > "21", eaten_kcal: day < "21" ? 1800 : 0, eaten_protein: 60, planned_kcal: day >= "21" ? 900 : 0, planned_protein: 30, people: [] })) };
const cycle: CycleStatus = { today: "2026-10-21", default_days: 7, history: [], cookable_now: 1, meals_left: 6, must_shop: false, empty_pantry: false, cycle: { start: "2026-10-19", planned_days: 7, planned_end: "2026-10-26", elapsed_days: 2, progress: 0.3, forecast_run_out: "2026-10-26", difference_days: 0, spend: 42, daily_spend: 6, extra_days_so_far: 0, saved_so_far: 0, projected_saving: 0, projected_extra_cost: 0, state: "on_track" } };
const integrations: Integrations = { tokens: [{ id: 1, name: "Home Gym", hint: "X4Rm", last_used: null }], webhooks: [], event_types: ["meal.cooked", "nutrition.daily"], last_export: null };

const routes: [RegExp, unknown][] = [
  [/^\/api\/bootstrap/, boot],
  [/^\/api\/calendar/, calendar],
  [/^\/api\/alerts\/\d+\/dismiss/, { ok: true }],
  [/^\/api\/alerts/, alerts],
  [/^\/api\/shopping/, { list: shopping }],
  [/^\/api\/home\/week/, week],
  [/^\/api\/cycle/, cycle],
  [/^\/api\/suggestions/, suggestions],
  [/^\/api\/recipes/, [recipe]],
  [/^\/api\/inventory/, inventory],
  [/^\/api\/ai/, boot.ai],
  [/^\/api\/integrations/, integrations],
  [/^\/api\/reports\/finance/, { summary: { spent: 10, waste: 0, waste_share: 0, per_day: 1, meals_cooked: 1, avg_meal_cost: 2, trips: 1 }, spending: [], stores: [], categories: [], top_items: [], waste_items: [], meals: [], meal_buckets: [], recipe_costs: [] }],
];

export const calls: { method: string; path: string; body: unknown }[] = [];

export function installFakeApi(): void {
  calls.length = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : input.url;
    const method = init?.method ?? "GET";
    calls.push({ method, path, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    const match = routes.find(([pattern]) => pattern.test(path));
    if (!match) return Promise.resolve(new Response(JSON.stringify({ error: "Not faked: " + path }), { status: 404 }));
    return Promise.resolve(new Response(JSON.stringify(match[1]), { status: 200 }));
  });
}

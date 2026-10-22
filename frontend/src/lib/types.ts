export type Id = number | string;
export type Unit = "g" | "ml" | "pcs";
export type ShopUnit = "g" | "kg" | "ml" | "l" | "pcs" | "pack";
export type RecipeUnit = "g" | "ml" | "pcs" | "jar" | "can" | "pack" | "tbsp" | "tsp";
export type Kind = "food" | "snack" | "staple" | "household";
export type Source = "app" | "alexa" | "automation" | "plan";

export interface User {
  id: number;
  name: string;
  color: string;
}

export interface AiModelStatus {
  name: string;
  blocked_seconds: number;
  ok_today: number;
  limited_today: number;
  failed_today: number;
  last_error: string | null;
}

export interface AiStatus {
  enabled: boolean;
  key_source: "settings" | "server" | null;
  key_hint: string | null;
  models: AiModelStatus[];
  key_set: boolean;
  model: string;
  queued: number;
  last_error: string | null;
  last_ok: string | null;
  cooldown_seconds: number;
}

export interface Boot {
  users: User[];
  ai: AiStatus;
  alerts: number;
  vapid: string;
  today: string;
  default_servings: number;
  alexa_skill_id: string;
  alexa_endpoint: string;
  categories: string[];
  icons: string[];
  stores: string[];
}

export interface Named {
  display?: string | null;
  name_en?: string | null;
  raw_name?: string | null;
  name?: string | null;
  name_fa?: string | null;
}

export interface IngredientRef extends Named {
  id: number;
  raw_name: string;
  name_en: string | null;
  name_fa: string | null;
  name_de: string | null;
  icon: string | null;
  category: string;
  kind: Kind;
  unit: Unit;
  status: "pending" | "ready" | "unresolved";
  piece_amount: number | null;
  package_amount: number | null;
  sold_by_piece?: number;
  display: string;
}

export interface Batch {
  id: number;
  qty_remaining: number;
  expires_at: string | null;
  purchased_at: string;
  pending_unit: string | null;
}

export interface PricePoint {
  date: string;
  store: string | null;
  qty: number;
  price: number;
  unit_price: number;
}

export interface Ingredient extends IngredientRef {
  sold_by_piece: number;
  kcal: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  fiber: number | null;
  tolerance_pct: number;
  unit_locked: number;
  shelf_days: number | null;
  ai_error: string | null;
  archived: number;
  stock: number;
  aliases: string[];
  pending_stock?: { unit: string; qty: number }[];
  batches?: Batch[];
  prices?: PricePoint[];
  expiring_estimate?: string | null;
}

export interface InventoryItem extends Ingredient {
  pending_stock: { unit: string; qty: number }[];
  batches: Batch[];
  expiring_estimate: string | null;
}

export interface Inventory {
  items: InventoryItem[];
  last_count: string | null;
}

export interface RecipeItem {
  id: number;
  recipe_id: number;
  slot: number;
  ingredient_id: number;
  amount: number;
  unit: RecipeUnit;
  optional: number;
  is_default: number;
  position: number;
  per_dish: number;
  ingredient: IngredientRef;
}

export interface Nutrition {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
}

export interface ImageCandidate {
  url: string;
  thumb: string;
  source: string;
  page?: string | null;
  credit?: string | null;
  license?: string | null;
}

export interface Recipe extends Named {
  id: number;
  raw_name: string;
  name_en: string | null;
  name_fa: string | null;
  name_de: string | null;
  description: string | null;
  tags: string[];
  cook_minutes: number | null;
  image_path: string | null;
  image_candidates: ImageCandidate[];
  image_status: "none" | "searching" | "choosing" | "set" | "none_found";
  status: "pending" | "ready" | "unresolved";
  ai_error: string | null;
  archived: number;
  display: string;
  slots: { slot: number; items: RecipeItem[] }[];
  nutrition_per_person: Nutrition;
  nutrition_complete: boolean;
  last_cooked: string | null;
}

export interface Shortage {
  ingredient_id: number;
  display: string;
  icon: string | null;
  missing: number;
  unit: Unit;
}

export interface MealRecipe {
  id: number;
  display: string;
  name_fa: string | null;
  image_path: string | null;
  archived: number;
}

export interface Meal {
  id: number;
  date: string;
  position: number;
  recipe_id: number;
  servings: number;
  status: "planned" | "cooked";
  choices: Record<string, number>;
  optional_items: number[];
  cooked_by: number | null;
  cooked_at: string | null;
  cost: number | null;
  kcal: number | null;
  protein: number | null;
  source: Source;
  recipe: MealRecipe | null;
  feasible?: boolean;
  shortages?: Shortage[];
  overdue?: boolean;
}

export interface CookResult extends Meal {
  shortfalls: { ingredient_id: number; display: string; missing: number; unit: Unit }[];
  unconvertible: number[];
}

export interface CalendarSnack {
  id: number;
  ingredient_id: number;
  qty: number;
  date: string;
  display: string;
  icon: string | null;
  unit: Unit;
}

export interface CalendarDay {
  date: string;
  meals: Meal[];
  snacks: CalendarSnack[];
}

export interface Suggestion {
  recipe_id: number;
  name: string;
  name_fa: string | null;
  image_path: string | null;
  tier: 0 | 1 | 2;
  breaks: number;
  last_cooked: string | null;
  planned_here: boolean;
  pool_meal_id: number | null;
  shortages: Shortage[];
}

export interface Suggestions {
  servings: number;
  suggestions: Suggestion[];
}

export interface PreviewLine {
  ingredient_id: number;
  display: string;
  name_fa: string | null;
  icon: string | null;
  qty: number;
  unit: Unit;
  stock: number;
}

export interface CookPreview {
  recipe: Recipe;
  servings: number;
  choices: Record<string, number>;
  optional_items: number[];
  lines: PreviewLine[];
  unconvertible: string[];
}

export interface ShoppingItem {
  id: Id;
  list_id?: number | null;
  ingredient_id?: number;
  auto: number;
  needed_qty: number | null;
  note?: string | null;
  checked: number;
  bought_qty: number | null;
  bought_unit?: ShopUnit | null;
  pack_size?: number | null;
  price: number | null;
  unit_price?: number | null;
  session_id: Id | null;
  committed: number;
  source?: Source;
  ingredient: IngredientRef;
  pieces?: number | null;
  packages?: number;
  unsure_stock?: { qty: number; unit: string }[];
}

export interface ShoppingSession {
  id: Id;
  list_id?: number;
  store: string;
  status: "active" | "paused" | "finished";
  total: number;
  count?: number;
}

export interface ShoppingList {
  id: number | null;
  status: string;
  range_start?: string | null;
  range_end?: string | null;
  items: ShoppingItem[];
  sessions: ShoppingSession[];
  active_session: ShoppingSession | null;
  total?: number;
}

export interface ReviewLine {
  ingredient_id: number;
  display: string;
  name_fa: string | null;
  icon: string | null;
  category: string;
  unit: Unit;
  stock: number;
  needed: number;
}

export interface Alert {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  payload: { list_id?: number; ingredient_id?: number; date?: string; meal_id?: number };
  status: string;
  created_at: string;
}

export interface CycleHistory {
  list_id: number;
  trip: string;
  planned_days: number | null;
  actual_days: number | null;
  spend: number;
  saved?: number;
  extra_cost?: number;
}

export type CycleStateName = "on_track" | "ahead" | "early" | "extended";

export interface Cycle {
  start: string;
  planned_days: number;
  planned_end: string;
  elapsed_days: number;
  progress: number;
  forecast_run_out: string;
  difference_days: number;
  spend: number;
  daily_spend: number;
  extra_days_so_far: number;
  saved_so_far: number;
  projected_saving: number;
  projected_extra_cost: number;
  state: CycleStateName;
}

export interface CycleStatus {
  today: string;
  default_days: number;
  history: CycleHistory[];
  cookable_now: number;
  meals_left: number;
  must_shop: boolean;
  empty_pantry: boolean;
  cycle: Cycle | null;
}

export interface WeekDay {
  date: string;
  is_today: boolean;
  is_future: boolean;
  eaten_kcal: number;
  eaten_protein: number;
  planned_kcal: number;
  planned_protein: number;
  people: { name: string; kcal: number }[];
}

export interface WeekSummary {
  start: string;
  days: WeekDay[];
  users: string[];
  average_kcal: number;
  average_planned_kcal: number;
}

export interface Finance {
  summary: { spent: number; waste: number; waste_share: number; per_day: number; meals_cooked: number; avg_meal_cost: number; trips: number };
  spending: { bucket: string; total: number }[];
  stores: { store: string; total: number; trips: number }[];
  categories: { category: string; total: number }[];
  top_items: { id: number; display: string; name_fa: string | null; icon: string | null; total: number; purchases: number }[];
  waste_items: { id: number; display: string; icon: string | null; unit: Unit; qty: number; total: number }[];
  meals: { id: number; date: string; servings: number; cost: number | null; kcal: number | null; display: string }[];
  meal_buckets: { bucket: string; total: number }[];
  recipe_costs: { id: number; display: string; times: number; per_serving: number | null; total: number }[];
}

export interface PriceTrend {
  id: number;
  display: string;
  name_fa: string | null;
  icon: string | null;
  unit_label: string;
  change_pct: number | null;
  history: PricePoint[];
  stores: { store: string; avg: number; count: number }[];
}

export interface NutritionDay {
  date: string;
  kcal: number;
  meal_kcal: number;
  snack_kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
}

export interface NutritionReport {
  days: NutritionDay[];
  weeks: { week: string; days: number; kcal: number; protein: number; fat: number; carbs: number; fiber: number }[];
  incomplete_meals: number;
}

export interface Period {
  id: number;
  range_start: string;
  range_end: string;
  status: string;
}

export interface PeriodLine {
  ingredient_id: number;
  display: string;
  icon: string | null;
  unit: Unit;
  bought: number;
  left: number;
  short: number;
}

export interface PeriodReport {
  planned_meals: number;
  cooked_meals: number;
  shortages: PeriodLine[];
  surplus: PeriodLine[];
}

export interface ApiToken {
  id: number;
  name: string;
  hint: string;
  last_used: string | null;
}

export interface Webhook {
  id: number;
  name: string;
  url: string;
  events: string[];
  active: number;
  last_status: string | null;
}

export interface Integrations {
  tokens: ApiToken[];
  webhooks: Webhook[];
  event_types: string[];
  last_export: string | null;
}

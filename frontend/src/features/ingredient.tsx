import { type ReactNode, useState } from "react";
import { useBoot } from "@/app/session";
import { get } from "@/lib/api";
import { money, parseNumber, qty, shortDate, trim } from "@/lib/format";
import { act } from "@/lib/offline";
import type { Ingredient, ShopUnit, Unit } from "@/lib/types";
import { IngredientIcon } from "@/ui/common";
import { ShopUnitSelect, UnitToggle } from "@/ui/controls";
import { Icon } from "@/ui/icons";
import { confirmSheet, openSheet, SheetLayout } from "@/ui/modal";
import { toast } from "@/ui/toast";
import { changed } from "./changed";

export type AdjustMode = "waste" | "count" | "add";

type FieldKind = "text" | "number" | "select" | "check";

export type EditableKey =
  | "name_en"
  | "name_fa"
  | "name_de"
  | "category"
  | "kind"
  | "unit"
  | "sold_by_piece"
  | "piece_amount"
  | "package_amount"
  | "tolerance_pct"
  | "shelf_days"
  | "kcal"
  | "protein"
  | "fat"
  | "carbs"
  | "fiber";

interface FieldSpec {
  key: EditableKey;
  label: string;
  kind: FieldKind;
  options?: readonly string[];
}

const KINDS = ["food", "snack", "staple", "household"] as const;
const UNITS = ["g", "ml", "pcs"] as const;

export function fieldValue(ingredient: Ingredient, key: EditableKey): string {
  const value = ingredient[key];
  if (value === null || value === undefined) return "";
  return String(value);
}

export function detailsPayload(values: Record<string, string>, specs: FieldSpec[]): Record<string, string | number | null> {
  const payload: Record<string, string | number | null> = {};
  for (const spec of specs) {
    const raw = values[spec.key] ?? "";
    if (spec.kind === "check") payload[spec.key] = raw === "1" || raw === "true" ? 1 : 0;
    else if (spec.kind === "number") payload[spec.key] = parseNumber(raw);
    else payload[spec.key] = raw.trim() || null;
  }
  return payload;
}

function IngredientBody({ ingredient, close, onDone }: { ingredient: Ingredient; close: () => void; onDone?: (() => void) | undefined }) {
  const boot = useBoot();
  const id = ingredient.id;
  const specs: FieldSpec[] = [
    { key: "name_en", label: "English", kind: "text" },
    { key: "name_fa", label: "Persian", kind: "text" },
    { key: "name_de", label: "German", kind: "text" },
    { key: "category", label: "Category", kind: "select", options: boot.categories },
    { key: "kind", label: "Kind", kind: "select", options: KINDS },
    { key: "unit", label: "Base unit", kind: "select", options: UNITS },
    { key: "sold_by_piece", label: "Bought per piece", kind: "check" },
    { key: "piece_amount", label: "Weight of one piece (g or ml)", kind: "number" },
    { key: "package_amount", label: "One jar, can or pack holds (base unit)", kind: "number" },
    { key: "tolerance_pct", label: "Extra to buy (%)", kind: "number" },
    { key: "shelf_days", label: "Keeps for days", kind: "number" },
    { key: "kcal", label: "kcal", kind: "number" },
    { key: "protein", label: "Protein g", kind: "number" },
    { key: "fat", label: "Fat g", kind: "number" },
    { key: "carbs", label: "Carbs g", kind: "number" },
    { key: "fiber", label: "Fiber g", kind: "number" },
  ];
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(specs.map((spec) => [spec.key, fieldValue(ingredient, spec.key)])));
  const after = () => {
    close();
    changed();
  };

  function field(spec: FieldSpec): ReactNode {
    const value = values[spec.key] ?? "";
    const set = (next: string) => setValues({ ...values, [spec.key]: next });
    let input: ReactNode;
    if (spec.kind === "select")
      input = (
        <select className="input" value={value} onChange={(event) => set(event.target.value)}>
          {(spec.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    else if (spec.kind === "check") input = <input type="checkbox" checked={value === "1"} onChange={(event) => set(event.target.checked ? "1" : "0")} />;
    else
      input = (
        <input
          className={"input" + (spec.kind === "number" ? " num" : "")}
          inputMode={spec.kind === "number" ? "decimal" : undefined}
          dir={spec.key === "name_fa" ? "rtl" : undefined}
          value={value}
          onChange={(event) => set(event.target.value)}
        />
      );
    return (
      <label key={spec.key} className="field">
        <span>{spec.label}</span>
        {input}
      </label>
    );
  }

  async function save() {
    await act("PATCH", "/api/ingredients/" + String(id), detailsPayload(values, specs));
    toast("Saved");
    close();
    changed();
    onDone?.();
  }

  const unitLabel = ingredient.unit === "pcs" ? "/pc" : ingredient.unit === "g" ? "/kg" : "/l";
  const section = (from: number, to: number) => <div className="row wrap">{specs.slice(from, to).map(field)}</div>;
  return (
    <SheetLayout title="Ingredient" onClose={close}>
      <div className="stack">
        <div className="row">
          <IngredientIcon ingredient={ingredient} size="xl" />
          <div className="grow">
            <h3>{ingredient.display}</h3>
            {ingredient.name_fa ? <div className="fa">{ingredient.name_fa}</div> : null}
            <div className="row wrap" style={{ marginTop: "6px" }}>
              <span className="chip">{ingredient.category}</span>
              <span className="chip">{ingredient.kind}</span>
              {ingredient.status === "pending" ? <span className="chip warn">Details on the way</span> : null}
              {ingredient.status === "unresolved" ? <span className="chip bad">Not recognised, edit by hand</span> : null}
            </div>
          </div>
        </div>
        {ingredient.ai_error && ingredient.status !== "ready" ? <p className="muted">{ingredient.ai_error}</p> : null}
        <div className="panel" style={{ padding: "14px" }}>
          <div className="spread">
            <div>
              <div className="muted">In the pantry</div>
              <b className="num" style={{ fontSize: "var(--s2)", fontFamily: "var(--display)" }}>
                {qty(ingredient.stock, ingredient.unit)}
              </b>
            </div>
            <div className="row wrap">
              <button
                type="button"
                className="btn small"
                onClick={() => {
                  act("POST", "/api/inventory/" + String(id) + "/used-up").then(
                    () => {
                      toast("Marked as used up");
                      after();
                    },
                    () => undefined,
                  );
                }}
              >
                Used up
              </button>
              <button type="button" className="btn small" onClick={() => openAdjustSheet(ingredient, "waste", after)}>
                Threw some away
              </button>
              <button type="button" className="btn small" onClick={() => openAdjustSheet(ingredient, "count", after)}>
                Set real amount
              </button>
              <button type="button" className="btn small" onClick={() => openAdjustSheet(ingredient, "add", after)}>
                Add stock
              </button>
            </div>
          </div>
        </div>
        {ingredient.prices?.length ? (
          <div>
            <h4>Prices paid</h4>
            {ingredient.prices
              .slice(-6)
              .reverse()
              .map((entry, index) => (
                <div key={String(index) + entry.date} className="list-row">
                  <span className="grow">
                    {shortDate(entry.date)} <span className="muted">{entry.store ?? ""}</span>
                  </span>
                  <span className="num soft">{qty(entry.qty, ingredient.unit)}</span>
                  <b className="num">{money(entry.price)}</b>
                  <span className="muted num">
                    {money(entry.unit_price)}
                    {unitLabel}
                  </span>
                </div>
              ))}
          </div>
        ) : null}
        <details>
          <summary className="btn ghost small">Edit details</summary>
          <div className="stack" style={{ marginTop: "10px" }}>
            {section(0, 3)}
            {section(3, 6)}
            {section(6, 11)}
            <div className="muted">Nutrition {ingredient.unit === "pcs" ? "per piece" : "per 100 " + ingredient.unit}</div>
            {section(11, 16)}
            <div className="row">
              <button type="button" className="btn primary small" onClick={() => void save().catch(() => undefined)}>
                Save details
              </button>
              {ingredient.status !== "ready" ? (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    act("POST", "/api/ingredients/" + String(id) + "/retry").then(
                      () => {
                        toast("Asked again");
                        after();
                      },
                      () => undefined,
                    );
                  }}
                >
                  <Icon name="refresh" />
                  Ask again
                </button>
              ) : null}
              <button
                type="button"
                className="btn small ghost danger"
                onClick={() => {
                  void confirmSheet("Archive " + ingredient.display + "?", "It disappears from lists and planning. Past records stay.", "Archive", true).then(async (ok) => {
                    if (!ok) return;
                    await act("POST", "/api/ingredients/" + String(id) + "/archive", { archived: true });
                    after();
                  });
                }}
              >
                Archive
              </button>
            </div>
          </div>
        </details>
      </div>
    </SheetLayout>
  );
}

export async function openIngredientSheet(id: number, onDone?: () => void): Promise<void> {
  const ingredient = await get<Ingredient>("/api/ingredients/" + String(id));
  openSheet((close) => <IngredientBody ingredient={ingredient} close={close} onDone={onDone} />, { wide: true, label: ingredient.display });
}

const TITLES: Record<AdjustMode, (name: string) => string> = {
  waste: (name) => "Threw away " + name,
  count: (name) => "How much " + name + " is really left?",
  add: (name) => "Add " + name,
};
const ACTIONS: Record<AdjustMode, string> = { waste: "Record waste", count: "Save amount", add: "Add to pantry" };

function AdjustBody({ ingredient, mode, close, onDone }: { ingredient: Ingredient; mode: AdjustMode; close: () => void; onDone?: (() => void) | undefined }) {
  const [amount, setAmount] = useState(mode === "count" ? trim(ingredient.stock || 0, 1) : "");
  const [unit, setUnit] = useState<string>(ingredient.unit);
  const [price, setPrice] = useState("");

  async function submit() {
    const value = parseNumber(amount);
    if (amount.trim() && (value === null || value < 0 || (mode !== "count" && value === 0))) {
      toast("The amount is not a number", true);
      return;
    }
    if (mode === "waste") await act("POST", "/api/inventory/" + String(ingredient.id) + "/waste", { qty: value, unit });
    else if (mode === "count") {
      if (value === null || value < 0) {
        toast("Enter an amount", true);
        return;
      }
      await act("POST", "/api/inventory/count", { entries: [{ ingredient_id: ingredient.id, qty: value }] });
    } else {
      if (!value) {
        toast("Enter an amount", true);
        return;
      }
      await act("POST", "/api/inventory/add", { ingredient_id: ingredient.id, qty: value, unit, price: parseNumber(price) });
    }
    close();
    toast("Pantry updated");
    onDone?.();
  }

  let unitControl: ReactNode;
  if (mode === "count") unitControl = <span className="muted">{ingredient.unit}</span>;
  else if (mode === "add") unitControl = <ShopUnitSelect<ShopUnit> value={unit as ShopUnit} onChange={setUnit} />;
  else unitControl = <UnitToggle<Unit> value={unit as Unit} onChange={setUnit} />;

  return (
    <SheetLayout
      title={TITLES[mode](ingredient.display)}
      onClose={close}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void submit().catch(() => undefined)}>
            {ACTIONS[mode]}
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="row">
          <input className="input num" inputMode="decimal" aria-label="Amount" placeholder={mode === "waste" ? "all" : ""} value={amount} onChange={(event) => setAmount(event.target.value)} />
          {unitControl}
        </div>
        {mode === "add" ? (
          <label className="field">
            <span>Price in euro</span>
            <input className="input num" inputMode="decimal" placeholder="optional" value={price} onChange={(event) => setPrice(event.target.value)} />
          </label>
        ) : null}
        {mode === "waste" ? <p className="muted">Leave empty to throw away everything that is left.</p> : null}
      </div>
    </SheetLayout>
  );
}

export function openAdjustSheet(ingredient: Ingredient, mode: AdjustMode, onDone?: () => void): void {
  openSheet((close) => <AdjustBody ingredient={ingredient} mode={mode} close={close} onDone={onDone} />, { label: TITLES[mode](ingredient.display) });
}

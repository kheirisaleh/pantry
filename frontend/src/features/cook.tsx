import { useState } from "react";
import { useToday } from "@/app/session";
import { ApiError } from "@/lib/api";
import { parseNumber, qty, trim } from "@/lib/format";
import { act } from "@/lib/offline";
import type { CookPreview, CookResult, Meal } from "@/lib/types";
import { FoodIcon, Names, Plate } from "@/ui/common";
import { Icon } from "@/ui/icons";
import { openSheet, SheetLayout } from "@/ui/modal";
import { toast } from "@/ui/toast";
import { changed } from "./changed";

export interface CookOptions {
  meal?: Meal | null;
  recipeId?: number;
  date?: string;
  onDone?: (result: CookResult) => void;
}

function CookBody({ initial, options, close }: { initial: CookPreview; options: CookOptions; close: () => void }) {
  const today = useToday();
  const recipe = initial.recipe;
  const [preview, setPreview] = useState(initial);
  const [servingsText, setServingsText] = useState(String(initial.servings));
  const [servings, setServings] = useState(initial.servings);
  const [choices, setChoices] = useState<Record<string, number>>({ ...initial.choices });
  const [optional, setOptional] = useState<number[]>(initial.optional_items.map(Number));
  const [overrides, setOverrides] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  function refresh(next: { servings?: number; choices?: Record<string, number>; optional?: number[] }) {
    act<CookPreview>("POST", "/api/cook/preview", {
      meal_id: options.meal?.id,
      recipe_id: recipe.id,
      servings: next.servings ?? servings,
      choices: next.choices ?? choices,
      optional_items: next.optional ?? optional,
    }).then(setPreview, () => undefined);
  }

  async function confirm() {
    setBusy(true);
    const values: Record<string, number> = {};
    for (const [key, text] of Object.entries(overrides)) {
      const value = parseNumber(text);
      if (value === null || value < 0) {
        toast("Check the amounts, one of them is not a number", true);
        setBusy(false);
        return;
      }
      values[key] = value;
    }
    try {
      const result = await act<CookResult>("POST", "/api/cook", {
        meal_id: options.meal?.id,
        recipe_id: recipe.id,
        date: options.date ?? options.meal?.date ?? today,
        servings,
        choices,
        optional_items: optional,
        overrides: Object.keys(values).length ? values : undefined,
      });
      close();
      toast(result.shortfalls.length ? "Cooked. Some items were not in the pantry." : "Cooked and pantry updated");
      changed();
      options.onDone?.(result);
    } catch {
      setBusy(false);
    }
  }

  const title = (
    <div className="row">
      <Plate recipe={recipe} size="54px" />
      <div>
        <h3>{recipe.display}</h3>
        {recipe.name_fa ? <div className="fa">{recipe.name_fa}</div> : null}
      </div>
    </div>
  );

  return (
    <SheetLayout
      title={title}
      onClose={close}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void confirm()}>
            <Icon name="flame" />
            Cooked it
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="row">
          <span className="soft">People</span>
          <input
            className="input num"
            inputMode="decimal"
            aria-label="People"
            style={{ width: "90px" }}
            value={servingsText}
            onChange={(event) => setServingsText(event.target.value)}
            onBlur={() => {
              const value = parseNumber(servingsText);
              if (value && value > 0 && value !== servings) {
                setServings(value);
                refresh({ servings: value });
              }
            }}
          />
        </div>
        <div className="stack">
          {recipe.slots.map((slot) => {
            const optionalItem = slot.items.find((item) => item.optional);
            const fallback = slot.items.find((item) => item.is_default) ?? slot.items[0];
            const selected = String(choices[slot.slot] ?? fallback?.id ?? "");
            if (slot.items.length < 2 && !optionalItem) return null;
            return (
              <div key={slot.slot} className="stack tight">
                {slot.items.length > 1 ? (
                  <div className="row wrap">
                    {slot.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={"chip" + (String(item.id) === selected ? " warn" : "")}
                        aria-pressed={String(item.id) === selected}
                        onClick={() => {
                          const next = { ...choices, [slot.slot]: item.id };
                          setChoices(next);
                          refresh({ choices: next });
                        }}
                      >
                        {item.ingredient.display}
                      </button>
                    ))}
                  </div>
                ) : null}
                {optionalItem ? (
                  <label className="row">
                    <input
                      type="checkbox"
                      checked={optional.includes(optionalItem.id)}
                      onChange={(event) => {
                        const next = event.target.checked ? [...optional, optionalItem.id] : optional.filter((id) => id !== optionalItem.id);
                        setOptional(next);
                        refresh({ optional: next });
                      }}
                    />
                    Also made <Names entity={optionalItem.ingredient} />
                  </label>
                ) : null}
              </div>
            );
          })}
        </div>
        <div>
          <h4 style={{ marginBottom: "4px" }}>Taken from the pantry</h4>
          <p className="muted" style={{ fontSize: "var(--s-1)" }}>
            Change an amount only if you used a different quantity.
          </p>
          {preview.lines.map((line) => {
            const text = overrides[line.ingredient_id] ?? trim(line.qty, 1);
            const used = parseNumber(text) ?? line.qty;
            return (
              <div key={line.ingredient_id} className="list-row">
                <FoodIcon name={line.icon} />
                <div className="grow">
                  <Names entity={line} />
                  <div className="muted num" style={{ fontSize: "var(--s-1)" }}>
                    In pantry {qty(line.stock, line.unit)}
                  </div>
                </div>
                {line.stock + 0.001 < used ? <span className="chip bad">short</span> : null}
                <input
                  className="input num"
                  inputMode="decimal"
                  aria-label={"Amount of " + line.display}
                  style={{ width: "96px" }}
                  value={text}
                  onChange={(event) => setOverrides({ ...overrides, [line.ingredient_id]: event.target.value })}
                />
                <span className="muted" style={{ width: "28px" }}>
                  {line.unit}
                </span>
              </div>
            );
          })}
          {preview.unconvertible.length ? <p className="muted">Not counted yet: {preview.unconvertible.join(", ")}</p> : null}
        </div>
      </div>
    </SheetLayout>
  );
}

export async function openCookSheet(options: CookOptions): Promise<void> {
  let preview: CookPreview;
  try {
    preview = await act<CookPreview>("POST", "/api/cook/preview", { meal_id: options.meal?.id, recipe_id: options.recipeId ?? options.meal?.recipe_id });
  } catch (error) {
    if (!(error instanceof ApiError)) return;
    return;
  }
  openSheet((close) => <CookBody initial={preview} options={options} close={close} />, { label: "Cook " + preview.recipe.display });
}

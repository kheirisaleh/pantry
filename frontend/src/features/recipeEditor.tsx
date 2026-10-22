import { useRef, useState } from "react";
import { parseNumber } from "@/lib/format";
import { act } from "@/lib/offline";
import type { IngredientRef, Recipe, RecipeUnit } from "@/lib/types";
import { FoodIcon, IngredientIcon, Names } from "@/ui/common";
import { IngredientPicker, type Picked, UnitSelect } from "@/ui/controls";
import { Icon } from "@/ui/icons";
import { openSheet, SheetLayout } from "@/ui/modal";
import { toast } from "@/ui/toast";
import { changed } from "./changed";

export interface DraftItem {
  key: number;
  ingredient_id?: number | undefined;
  ingredient?: IngredientRef | undefined;
  name?: string | undefined;
  amount: string;
  unit: RecipeUnit;
  is_default: boolean;
  per_dish: boolean;
}

export interface DraftSlot {
  key: number;
  optional: boolean;
  items: DraftItem[];
}

let keys = 0;
function nextKey(): number {
  keys += 1;
  return keys;
}

export function draftFromRecipe(recipe: Recipe | null): DraftSlot[] {
  if (!recipe) return [];
  return recipe.slots.map((slot) => ({
    key: nextKey(),
    optional: slot.items.some((item) => item.optional),
    items: slot.items.map((item) => ({
      key: nextKey(),
      ingredient_id: item.ingredient_id,
      ingredient: item.ingredient,
      amount: String(item.amount),
      unit: item.unit,
      is_default: Boolean(item.is_default),
      per_dish: Boolean(item.per_dish),
    })),
  }));
}

export function draftItem(picked: Picked, isDefault: boolean): DraftItem {
  return {
    key: nextKey(),
    ingredient_id: picked.ingredient_id,
    ingredient: picked.ingredient,
    name: picked.name,
    amount: "",
    unit: picked.ingredient?.unit ?? "g",
    is_default: isDefault,
    per_dish: false,
  };
}

export function recipePayload(name: string, slots: DraftSlot[]): { error: string } | { payload: { name: string; slots: unknown[] } } {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Give the dish a name" };
  if (!slots.length) return { error: "Add at least one ingredient" };
  const converted = slots.map((slot) => ({
    optional: slot.optional,
    items: slot.items.map((item) => ({
      ingredient_id: item.ingredient_id,
      name: item.name,
      amount: parseNumber(item.amount),
      unit: item.unit,
      is_default: item.is_default,
      per_dish: item.per_dish,
    })),
  }));
  if (converted.some((slot) => slot.items.some((item) => !item.amount || item.amount <= 0))) return { error: "Every ingredient needs an amount" };
  return { payload: { name: trimmed, slots: converted } };
}

function SlotCard({ slot, index, onChange, onRemoveSlot }: { slot: DraftSlot; index: number; onChange: (slot: DraftSlot) => void; onRemoveSlot: () => void }) {
  const [showAlternative, setShowAlternative] = useState(false);
  const update = (item: DraftItem, patch: Partial<DraftItem>) => onChange({ ...slot, items: slot.items.map((entry) => (entry === item ? { ...entry, ...patch } : entry)) });
  return (
    <div className={"slot-card" + (slot.optional ? " optional" : "")}>
      {slot.items.map((item, itemIndex) => (
        <div key={item.key} className="alt-line">
          <span className="al-icon">{item.ingredient ? <IngredientIcon ingredient={item.ingredient} /> : <FoodIcon name="package" pending />}</span>
          <div className="stack tight al-name" style={{ minWidth: 0 }}>
            <div className="ellipsis">
              {slot.items.length > 1 && itemIndex > 0 ? <span className="or">or </span> : null}
              {item.ingredient ? (
                <Names entity={item.ingredient} />
              ) : (
                <span>
                  {item.name} <span className="chip">new</span>
                </span>
              )}
            </div>
            {slot.items.length > 1 ? (
              <label className="row muted" style={{ fontSize: "var(--s-1)", gap: "6px" }}>
                <input
                  type="radio"
                  name={"default-" + String(index)}
                  checked={item.is_default}
                  onChange={() => onChange({ ...slot, items: slot.items.map((entry) => ({ ...entry, is_default: entry === item })) })}
                />
                Planned by default
              </label>
            ) : null}
          </div>
          <span className="al-amount">
            <input
              className="input num amount"
              inputMode="decimal"
              aria-label={"Amount of " + (item.ingredient?.display ?? item.name ?? "ingredient")}
              placeholder={item.per_dish ? "whole dish" : "per person"}
              value={item.amount}
              onChange={(event) => update(item, { amount: event.target.value })}
            />
          </span>
          <span className="al-unit">
            <UnitSelect
              value={item.unit}
              onChange={(unit) => {
                update(item, { unit });
                if (["jar", "can", "pack"].includes(unit) && !item.ingredient?.package_amount) {
                  toast("Set how much one " + unit + " holds in this ingredient's details so the shopping list can count it");
                }
              }}
            />
          </span>
          <label className="row muted al-whole" style={{ fontSize: "var(--s-1)", gap: "4px", whiteSpace: "nowrap" }} title="Use this amount for the whole dish, not per person">
            <input type="checkbox" checked={item.per_dish} onChange={(event) => update(item, { per_dish: event.target.checked })} />
            Whole dish
          </label>
          <button
            type="button"
            className="btn icon small ghost al-del"
            aria-label={"Remove " + (item.ingredient?.display ?? item.name ?? "ingredient")}
            onClick={() => {
              const rest = slot.items.filter((entry) => entry !== item);
              if (!rest.length) {
                onRemoveSlot();
                return;
              }
              if (!rest.some((entry) => entry.is_default)) rest[0] = { ...rest[0]!, is_default: true };
              onChange({ ...slot, items: rest });
            }}
          >
            <Icon name="trash" />
          </button>
        </div>
      ))}
      <div className="row wrap">
        <label className="row muted" style={{ fontSize: "var(--s-1)", gap: "6px" }}>
          <input type="checkbox" checked={slot.optional} onChange={(event) => onChange({ ...slot, optional: event.target.checked })} />
          Optional side
        </label>
        <button type="button" className="btn small ghost" onClick={() => setShowAlternative(true)}>
          Add an alternative
        </button>
      </div>
      {showAlternative ? (
        <IngredientPicker
          placeholder="Or use instead"
          autoFocus
          onPick={(picked) => {
            onChange({ ...slot, items: [...slot.items, draftItem(picked, false)] });
            setShowAlternative(false);
          }}
        />
      ) : null}
    </div>
  );
}

function EditorBody({ existing, onSaved, close }: { existing: Recipe | null; onSaved?: ((recipe: Recipe) => void) | undefined; close: () => void }) {
  const [name, setName] = useState(existing?.raw_name ?? "");
  const [slots, setSlots] = useState<DraftSlot[]>(() => draftFromRecipe(existing));
  const [saving, setSaving] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const focusLast = () => {
    window.requestAnimationFrame(() => {
      const inputs = host.current?.querySelectorAll<HTMLInputElement>("input.amount");
      inputs?.[inputs.length - 1]?.focus();
    });
  };

  async function save() {
    const result = recipePayload(name, slots);
    if ("error" in result) {
      toast(result.error, true);
      return;
    }
    setSaving(true);
    try {
      const saved = existing ? await act<Recipe>("PUT", "/api/recipes/" + String(existing.id), result.payload) : await act<Recipe>("POST", "/api/recipes", result.payload);
      close();
      toast(existing ? "Dish saved" : "Dish added");
      changed();
      onSaved?.(saved);
    } catch {
      setSaving(false);
    }
  }

  return (
    <SheetLayout
      title={existing ? "Edit dish" : "New dish"}
      subtitle="Amounts are for one person. English name, Persian name, photo and nutrition are added for you."
      onClose={close}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={saving} onClick={() => void save()}>
            {existing ? "Save dish" : "Add dish"}
          </button>
        </>
      }
    >
      <div className="stack">
        <label className="field">
          <span>Dish</span>
          <input className="input" placeholder="Dish name, any language. For example loobia polo" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="field">
          <span>Ingredients</span>
          <div className="stack" ref={host}>
            {!slots.length ? <p className="muted">Add each ingredient with the amount one person needs. The rest is filled in automatically.</p> : null}
            {slots.map((slot, index) => (
              <SlotCard
                key={slot.key}
                slot={slot}
                index={index}
                onChange={(next) => setSlots(slots.map((entry) => (entry === slot ? next : entry)))}
                onRemoveSlot={() => setSlots(slots.filter((entry) => entry !== slot))}
              />
            ))}
          </div>
          <IngredientPicker
            placeholder="Add an ingredient. Type in Persian, Finglish, German or English"
            onPick={(picked) => {
              setSlots([...slots, { key: nextKey(), optional: false, items: [draftItem(picked, true)] }]);
              focusLast();
            }}
          />
        </div>
      </div>
    </SheetLayout>
  );
}

export function openRecipeEditor(existing: Recipe | null, onSaved?: (recipe: Recipe) => void): void {
  openSheet((close) => <EditorBody existing={existing} onSaved={onSaved} close={close} />, { wide: true, label: existing ? "Edit dish" : "New dish" });
}

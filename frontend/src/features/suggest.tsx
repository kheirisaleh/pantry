import { useState } from "react";
import { useBoot, useToday } from "@/app/session";
import { get, query } from "@/lib/api";
import { dayLabel, parseNumber, qty, shortDate } from "@/lib/format";
import { TIER_TITLES } from "@/lib/kitchen";
import { act } from "@/lib/offline";
import type { Meal, Suggestions } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { Empty, Names, Plate } from "@/ui/common";
import { Icon } from "@/ui/icons";
import { openSheet, SheetLayout } from "@/ui/modal";
import { toast } from "@/ui/toast";
import { changed } from "./changed";
import { openCookSheet } from "./cook";
import { openRecipeEditor } from "./recipeEditor";

export interface SuggestOptions {
  date: string;
  meal?: Meal | null;
  onDone?: () => void;
}

function SuggestBody({ options, close }: { options: SuggestOptions; close: () => void }) {
  const boot = useBoot();
  const today = useToday();
  const { date, meal } = options;
  const [servingsText, setServingsText] = useState(String(meal?.servings ?? boot.default_servings ?? 2));
  const [servings, setServings] = useState(parseNumber(servingsText) ?? 2);
  const data = useResource((signal) => get<Suggestions>("/api/suggestions" + query({ date, servings, meal_id: meal?.id }), { signal }), [date, servings, meal?.id]);

  async function plan(recipeId: number) {
    if (meal) await act("PATCH", "/api/meals/" + String(meal.id), { recipe_id: recipeId, servings });
    else await act("POST", "/api/meals", { date, recipe_id: recipeId, servings });
    close();
    toast("Planned for " + dayLabel(date, today).toLowerCase());
    changed();
    options.onDone?.();
  }

  async function cookNow(recipeId: number) {
    close();
    if (meal) await act("PATCH", "/api/meals/" + String(meal.id), { recipe_id: recipeId, servings });
    void openCookSheet({ meal: meal ? { ...meal, recipe_id: recipeId } : null, recipeId, date, ...(options.onDone ? { onDone: options.onDone } : {}) });
  }

  let body;
  if (data.error && !data.data) body = <p className="bad">{data.error.message}</p>;
  else if (!data.data) body = <p className="muted">Checking the pantry</p>;
  else if (!data.data.suggestions.length)
    body = (
      <Empty icon="cooking">
        No dishes yet.
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            close();
            openRecipeEditor(null);
          }}
        >
          Add your first dish
        </button>
      </Empty>
    );
  else {
    let lastTier = -1;
    body = data.data.suggestions.map((entry) => {
      const heading = entry.tier !== lastTier ? <div className="group-title">{TIER_TITLES[entry.tier]}</div> : null;
      lastTier = entry.tier;
      return (
        <div key={entry.recipe_id}>
          {heading}
          <div className="list-row">
            <Plate recipe={entry} size="52px" short={entry.tier === 2} />
            <div className="grow">
              <div>
                <Names entity={entry} />
              </div>
              <div className="row wrap" style={{ marginTop: "4px", gap: "6px" }}>
                {entry.shortages.slice(0, 4).map((short) => (
                  <span key={short.ingredient_id} className="chip bad">
                    {short.display} {qty(short.missing, short.unit)}
                  </span>
                ))}
                {entry.breaks ? <span className="chip warn">{"Affects " + String(entry.breaks) + " planned dish" + (entry.breaks > 1 ? "es" : "")}</span> : null}
                {entry.last_cooked ? <span className="chip">Last cooked {shortDate(entry.last_cooked)}</span> : null}
              </div>
            </div>
            <div className="row">
              <button type="button" className="btn small" onClick={() => void plan(entry.recipe_id)}>
                {meal ? "Use this" : "Plan"}
              </button>
              {date <= today ? (
                <button type="button" className="btn small primary" onClick={() => void cookNow(entry.recipe_id)}>
                  <Icon name="flame" />
                  Cook
                </button>
              ) : null}
            </div>
          </div>
        </div>
      );
    });
  }

  const title = meal ? "Change " + dayLabel(date, today).toLowerCase() + "'s dish" : "What to eat " + (date === today ? "today" : dayLabel(date, today));
  return (
    <SheetLayout
      title={title}
      subtitle="Dishes you can make with what is at home come first, and the ones that keep the rest of your plan intact before the others."
      onClose={close}
    >
      <div className="stack">
        <div className="row">
          <span className="soft">People</span>
          <input
            className="input num"
            inputMode="decimal"
            aria-label="People"
            style={{ width: "80px" }}
            value={servingsText}
            onChange={(event) => setServingsText(event.target.value)}
            onBlur={() => setServings(parseNumber(servingsText) || 2)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </div>
        <div className="stack">{body}</div>
      </div>
    </SheetLayout>
  );
}

export function openSuggestSheet(options: SuggestOptions): void {
  openSheet((close) => <SuggestBody options={options} close={close} />, { wide: true, label: "Choose a dish" });
}

import { useState } from "react";
import { useToday } from "@/app/session";
import { money, parseNumber, qty, shortDate, trim } from "@/lib/format";
import { act } from "@/lib/offline";
import type { Meal } from "@/lib/types";
import { Plate } from "@/ui/common";
import { Icon } from "@/ui/icons";
import { openSheet, SheetLayout } from "@/ui/modal";
import { toast } from "@/ui/toast";
import { changed } from "./changed";
import { openCookSheet } from "./cook";
import { openSuggestSheet } from "./suggest";

function MealBody({ meal, close }: { meal: Meal; close: () => void }) {
  const today = useToday();
  const cooked = meal.status === "cooked";
  const [servings, setServings] = useState(trim(meal.servings, 1));
  const [date, setDate] = useState(meal.date);
  const recipe = meal.recipe;
  const title = (
    <div className="row">
      <Plate recipe={recipe} size="56px" cooked={cooked} />
      <div>
        <h3>{recipe?.display ?? "Dish"}</h3>
        {recipe?.name_fa ? <div className="fa">{recipe.name_fa}</div> : null}
      </div>
    </div>
  );

  const run = (work: () => Promise<unknown>) => {
    work().then(
      () => undefined,
      () => undefined,
    );
  };

  const footer = cooked ? (
    <button
      type="button"
      className="btn ghost"
      onClick={() =>
        run(async () => {
          await act("POST", "/api/meals/" + String(meal.id) + "/uncook");
          toast("Cooking undone, ingredients are back");
          close();
          changed();
        })
      }
    >
      <Icon name="undo" />
      Undo cooking
    </button>
  ) : (
    <>
      <button
        type="button"
        className="btn ghost danger"
        onClick={() =>
          run(async () => {
            await act("DELETE", "/api/meals/" + String(meal.id));
            close();
            changed();
          })
        }
      >
        <Icon name="trash" />
        Remove
      </button>
      <button
        type="button"
        className="btn"
        onClick={() => {
          close();
          openSuggestSheet({ date: meal.date, meal });
        }}
      >
        Change dish
      </button>
      <button
        type="button"
        className="btn"
        onClick={() =>
          run(async () => {
            const value = parseNumber(servings);
            if (!value || value <= 0) {
              toast("People must be more than zero", true);
              return;
            }
            await act("PATCH", "/api/meals/" + String(meal.id), { servings: value, date });
            close();
            changed();
          })
        }
      >
        Save
      </button>
      {meal.date <= today ? (
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            close();
            void openCookSheet({ meal, date: meal.date });
          }}
        >
          <Icon name="flame" />
          Cook
        </button>
      ) : null}
    </>
  );

  return (
    <SheetLayout title={title} onClose={close} footer={footer}>
      <div className="stack">
        {cooked ? (
          <div className="stack tight">
            <p className="soft">
              Cooked {meal.cooked_at ? "on " + shortDate(meal.cooked_at) : ""} for {trim(meal.servings, 1)} people.
            </p>
            <div className="row wrap">
              {meal.cost !== null ? <span className="chip">{money(meal.cost)}</span> : null}
              {meal.kcal !== null ? <span className="chip">{Math.round(meal.kcal)} kcal</span> : null}
              {meal.protein !== null ? <span className="chip">{Math.round(meal.protein)} g protein</span> : null}
            </div>
          </div>
        ) : (
          <div className="row wrap">
            <label className="field">
              <span>People</span>
              <input className="input num" inputMode="decimal" style={{ width: "90px" }} value={servings} onChange={(event) => setServings(event.target.value)} />
            </label>
            <label className="field">
              <span>Day</span>
              <input className="input" type="date" style={{ width: "170px" }} value={date} onChange={(event) => setDate(event.target.value)} />
            </label>
          </div>
        )}
        {!cooked && meal.shortages?.length ? (
          <div className="row wrap">
            <span className="soft">Will be short:</span>
            {meal.shortages.map((short) => (
              <span key={short.ingredient_id} className="chip bad">
                {short.display} {qty(short.missing, short.unit)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </SheetLayout>
  );
}

export function openMealMenu(meal: Meal): void {
  openSheet((close) => <MealBody meal={meal} close={close} />, { label: meal.recipe?.display ?? "Meal" });
}

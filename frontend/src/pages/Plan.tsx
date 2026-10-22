import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useMobile, usePath } from "@/app/mobile";
import { useToday } from "@/app/session";
import { View } from "@/app/View";
import { openBuildListSheet } from "@/features/buildList";
import { changed } from "@/features/changed";
import { openMealMenu } from "@/features/meal";
import { moveMeal, useMealDrag } from "@/features/planDrag";
import { openSuggestSheet } from "@/features/suggest";
import { get, query } from "@/lib/api";
import { addDays, fromIso, monday, shortDate, trim } from "@/lib/format";
import { act } from "@/lib/offline";
import type { CalendarDay } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { FoodIcon, PageHead, Plate } from "@/ui/common";
import { Icon } from "@/ui/icons";
import { toast } from "@/ui/toast";
import type { CSSProperties } from "react";

const DAYS = 14;
let rememberedStart: string | null = null;

export function PlanPage() {
  const today = useToday();
  const mobile = useMobile();
  const navigate = useNavigate();
  const path = usePath();
  const [start, setStart] = useState(() => rememberedStart ?? monday(today));
  const end = addDays(start, DAYS - 1);
  const data = useResource((signal) => get<CalendarDay[]>("/api/calendar" + query({ start, end }), { signal }), [start, end], ["plan", "pantry", "recipes"]);
  const board = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  useEffect(() => {
    rememberedStart = start;
  }, [start]);

  const { setData } = data;
  useMealDrag(board, (mealId, date, index) => {
    setData((current) => moveMeal(current ?? [], mealId, date, index));
    act("POST", "/api/meals/" + String(mealId) + "/move", { date, index }).then(
      () => toast("Moved to " + fromIso(date).toLocaleDateString("en-GB", { weekday: "long" })),
      () => undefined,
    ).finally(changed);
  }, Boolean(data.data));

  useEffect(() => {
    if (!mobile || !data.data || scrolled.current) return;
    scrolled.current = true;
    requestAnimationFrame(() => {
      const current = board.current?.querySelector(".day.is-today");
      if (current) window.scrollTo({ top: current.getBoundingClientRect().top + window.scrollY - 80 });
    });
  }, [mobile, data.data]);

  return (
    <View route="plan" ready={Boolean(data.data)} error={data.error} onRetry={data.reload}>
      {() => (
        <>
          <PageHead
            title="Plan"
            subtitle={mobile ? "Hold a dish to move it to another day or change its order." : "Drag dishes between days or reorder them. The order inside a day is the meal order."}
            actions={
              <>
                <div className="row">
                  <button type="button" className="btn icon" aria-label="Earlier" onClick={() => setStart(addDays(start, -7))}>
                    <Icon name="left" />
                  </button>
                  <button type="button" className="btn" onClick={() => setStart(monday(today))}>
                    {shortDate(start) + " to " + shortDate(end)}
                  </button>
                  <button type="button" className="btn icon" aria-label="Later" onClick={() => setStart(addDays(start, 7))}>
                    <Icon name="right" />
                  </button>
                </div>
                <button type="button" className="btn primary" onClick={() => openBuildListSheet(() => void navigate(path("shop")))}>
                  <Icon name="cart" />
                  Build shopping list
                </button>
              </>
            }
          />
          <div className={mobile ? "day-list" : "week-board"} ref={board}>
            {data.data!.map((entry) => (
              <div key={entry.date} className={"day" + (entry.date === today ? " is-today" : "") + (entry.date < today ? " is-past" : "")}>
                <div className="day-head">
                  <span className="day-name">{fromIso(entry.date).toLocaleDateString("en-GB", { weekday: "short" })}</span>
                  <span className="day-num num">{fromIso(entry.date).getDate()}</span>
                </div>
                <div className="day-meals" data-date={entry.date}>
                  {entry.meals.map((meal, mealIndex) => {
                    const cooked = meal.status === "cooked";
                    const short = Boolean(meal.shortages?.length);
                    return (
                      <button
                        key={meal.id}
                        type="button"
                        className={"meal" + (cooked ? " cooked" : "") + (meal.overdue ? " overdue" : "")}
                        data-meal-id={meal.id}
                        style={{ "--i": mealIndex } as CSSProperties}
                        onClick={() => openMealMenu(meal)}
                      >
                        <span className="meal-plate">
                          <Plate recipe={meal.recipe} size={mobile ? "44px" : "52px"} cooked={cooked} short={short} />
                          {entry.meals.length > 1 ? <span className="meal-order num">{mealIndex + 1}</span> : null}
                        </span>
                        <span className="meal-text">
                          <span className="meal-name">
                            {meal.recipe?.display}
                            {meal.source === "alexa" ? (
                              <span className="source-dot" title="Added by Alexa">
                                <Icon name="mic" />
                              </span>
                            ) : null}
                          </span>
                          <span className="meal-meta">
                            for {trim(meal.servings, 1)}
                            {cooked ? ", cooked" : short ? ", short" : meal.overdue ? ", not cooked" : ""}
                          </span>
                        </span>
                        {cooked ? null : (
                          <span className="meal-grip" aria-hidden="true">
                            <Icon name="grip" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {entry.snacks.map((snack) => (
                    <div key={snack.id} className="snack-line">
                      <FoodIcon name={snack.icon} size="sm" />
                      {snack.display}
                    </div>
                  ))}
                  <button type="button" className="day-add" aria-label={"Plan a meal on " + entry.date} onClick={() => openSuggestSheet({ date: entry.date })}>
                    <Icon name="plus" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </View>
  );
}

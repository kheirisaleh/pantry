import { useNavigate } from "react-router";
import { usePath, useMobile } from "@/app/mobile";
import { useToday, useUser } from "@/app/session";
import { View } from "@/app/View";
import { changed } from "@/features/changed";
import { openCookSheet } from "@/features/cook";
import { openMealMenu } from "@/features/meal";
import { openSnackSheet } from "@/features/snack";
import { openSuggestSheet } from "@/features/suggest";
import { CookableReel, CycleCard, StatusChip, WeekCard } from "@/features/today";
import { get, query } from "@/lib/api";
import { addDays, greeting, longDate, money, qty, shortDate, trim } from "@/lib/format";
import { act } from "@/lib/offline";
import type { Alert, CalendarDay, CycleStatus, ShoppingList, Suggestion, Suggestions, WeekSummary } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { FoodIcon, PageHead, Plate } from "@/ui/common";
import { Icon } from "@/ui/icons";

interface TodayData {
  calendar: CalendarDay[];
  alerts: Alert[];
  shopping: { list: ShoppingList | null };
  week: WeekSummary | null;
  cycle: CycleStatus | null;
  suggest: Suggestions;
}

async function loadToday(day: string, signal: AbortSignal): Promise<TodayData> {
  const [calendar, alerts, shopping, week, cycle, suggest] = await Promise.all([
    get<CalendarDay[]>("/api/calendar" + query({ start: day, end: addDays(day, 2) }), { signal }),
    get<Alert[]>("/api/alerts", { signal }),
    get<{ list: ShoppingList | null }>("/api/shopping", { signal }),
    get<WeekSummary>("/api/home/week", { signal }).catch(() => null),
    get<CycleStatus>("/api/cycle", { signal }).catch(() => null),
    get<Suggestions>("/api/suggestions" + query({ date: day }), { signal }).catch(() => ({ servings: 2, suggestions: [] })),
  ]);
  return { calendar, alerts, shopping, week, cycle, suggest };
}

export function TodayPage() {
  const day = useToday();
  const user = useUser();
  const mobile = useMobile();
  const navigate = useNavigate();
  const path = usePath();
  const data = useResource((signal) => loadToday(day, signal), [day], ["plan", "alerts", "shop", "pantry", "recipes"]);

  return (
    <View route="today" ready={Boolean(data.data)} error={data.error} onRetry={data.reload}>
      {() => {
        const { calendar, alerts, shopping, week, cycle, suggest } = data.data!;
        const now = new Date();
        const todayData = calendar[0] ?? { date: day, meals: [], snacks: [] };
        const cookedToday = todayData.meals.filter((meal) => meal.status === "cooked");
        const pool = suggest.suggestions.filter((entry) => entry.pool_meal_id);
        const cookPick = (entry: Suggestion) => void openCookSheet({ recipeId: entry.recipe_id, date: day, onDone: changed });
        const list = shopping.list;
        const toBuy = list ? list.items.filter((item) => !item.committed && !item.checked).length : 0;
        return (
          <>
            <PageHead
              title={greeting(now.getHours()) + (user ? ", " + user.name : "")}
              subtitle={longDate(now)}
              actions={
                <>
                  <button type="button" className="btn" onClick={openSnackSheet}>
                    Log a snack
                  </button>
                  <button type="button" className="btn primary" onClick={() => openSuggestSheet({ date: day })}>
                    What can I cook?
                  </button>
                </>
              }
            />
            <section className={"stage" + (cookedToday.length ? "" : " stage-reel-host")}>
              {cookedToday.length ? (
                <div className="stage-plates">
                  {cookedToday.map((meal) => (
                    <button key={meal.id} type="button" className="stage-plate" onClick={() => openMealMenu(meal)}>
                      <Plate recipe={meal.recipe} size={mobile ? "132px" : "190px"} cooked />
                      <div className="stage-caption">
                        <h3>{meal.recipe?.display}</h3>
                        {meal.recipe?.name_fa ? <div className="fa">{meal.recipe.name_fa}</div> : null}
                        <div className="row wrap" style={{ justifyContent: "center", marginTop: "8px" }}>
                          <span className="chip">for {trim(meal.servings, 1)}</span>
                          <span className="chip warn">cooked today</span>
                        </div>
                      </div>
                    </button>
                  ))}
                  <button type="button" className="stage-add" aria-label="Cook something else" onClick={() => openSuggestSheet({ date: day })}>
                    <Icon name="plus" />
                  </button>
                </div>
              ) : (
                <CookableReel
                  suggest={suggest}
                  cycle={cycle}
                  mobile={mobile}
                  onCook={cookPick}
                  onChoose={() => openSuggestSheet({ date: day })}
                  onShop={() => void navigate(path("shop"))}
                />
              )}
            </section>
            {cycle?.cycle ? <CycleCard state={cycle} /> : null}
            <div className="today-grid">
              {week ? <WeekCard week={week} /> : null}
              <section className="panel">
                <h3>On the shopping plan</h3>
                <p className="soft">These dishes set the shopping list. Cook them in any order, or anything else the pantry allows.</p>
                {!pool.length ? <p className="muted">Nothing left from this week&apos;s plan.</p> : null}
                {pool.map((entry) => (
                  <button
                    key={entry.recipe_id}
                    type="button"
                    className="list-row"
                    style={{ width: "100%", background: "none", border: "0", color: "inherit", textAlign: "left" }}
                    onClick={() => cookPick(entry)}
                  >
                    <Plate recipe={entry} size="40px" />
                    <div className="grow">
                      <div>{entry.name}</div>
                      {entry.name_fa ? <div className="fa soft">{entry.name_fa}</div> : null}
                    </div>
                    <StatusChip entry={entry} />
                  </button>
                ))}
              </section>
              <section className="panel">
                <div className="spread">
                  <h3>Shopping</h3>
                  <button type="button" className="btn small" onClick={() => void navigate(path("shop"))}>
                    Open list
                  </button>
                </div>
                {list ? (
                  <p className="soft">
                    {toBuy ? String(toBuy) + " item" + (toBuy === 1 ? "" : "s") + " to buy" : "Everything on the list is bought."}
                    {list.range_start && list.range_end ? <span className="muted">{" for " + shortDate(list.range_start) + " to " + shortDate(list.range_end)}</span> : null}
                  </p>
                ) : (
                  <p className="soft">No open list. Plan your meals, then build one from the planner.</p>
                )}
                {list?.active_session ? (
                  <p>
                    Shopping at <b>{list.active_session.store}</b>, <b className="num">{money(list.active_session.total)}</b> so far
                  </p>
                ) : null}
              </section>
              <section className="panel">
                <div className="spread">
                  <h3>Notes</h3>
                  {alerts.length ? (
                    <button type="button" className="btn small" onClick={() => void navigate(path("alerts"))}>
                      See all
                    </button>
                  ) : null}
                </div>
                {!alerts.length ? <p className="muted">Nothing needs attention.</p> : null}
                {alerts.slice(0, 3).map((alert) => (
                  <div key={alert.id} className="list-row">
                    <span className={"dot " + alert.kind} />
                    <div className="grow">
                      <div>{alert.title}</div>
                      <div className="muted" style={{ fontSize: "var(--s-1)" }}>
                        {alert.body}
                      </div>
                    </div>
                  </div>
                ))}
              </section>
              {todayData.snacks.length ? (
                <section className="panel">
                  <h3>Snacks today</h3>
                  {todayData.snacks.map((snack) => (
                    <div key={snack.id} className="list-row">
                      <FoodIcon name={snack.icon} size="sm" />
                      <span className="grow">{snack.display}</span>
                      <span className="muted num">{qty(snack.qty, snack.unit)}</span>
                      <button
                        type="button"
                        className="btn icon small ghost"
                        aria-label="Remove snack"
                        onClick={() => {
                          act("DELETE", "/api/snacks/" + String(snack.id)).then(changed, () => undefined);
                        }}
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  ))}
                </section>
              ) : null}
            </div>
          </>
        );
      }}
    </View>
  );
}

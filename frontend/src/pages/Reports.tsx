import { type ReactNode, useState } from "react";
import { useToday } from "@/app/session";
import { View } from "@/app/View";
import { get, query } from "@/lib/api";
import { addDays, money, qty, shortDate, trim } from "@/lib/format";
import type { Finance, NutritionReport, Period, PeriodReport, PriceTrend } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { ChartBox, SERIES } from "@/ui/charts";
import { Empty, FoodIcon, LoadError, Names, PageHead } from "@/ui/common";
import { Icon } from "@/ui/icons";

export type ReportTab = "money" | "prices" | "nutrition" | "plans";
type Period3 = "day" | "week" | "month";

export const reportState: { tab: ReportTab; period: Period3; start: string | null; end: string | null; periodId: number | null } = {
  tab: "money",
  period: "week",
  start: null,
  end: null,
  periodId: null,
};

const euroTicks = { ticks: { callback: (value: string | number) => String(value) + " €" } };

function Range({ withPeriod, onChange }: { withPeriod: boolean; onChange: () => void }) {
  const today = useToday();
  return (
    <div className="row wrap">
      <label className="field">
        <span>From</span>
        <input
          className="input"
          type="date"
          value={reportState.start ?? addDays(today, -89)}
          onChange={(event) => {
            reportState.start = event.target.value;
            onChange();
          }}
        />
      </label>
      <label className="field">
        <span>To</span>
        <input
          className="input"
          type="date"
          value={reportState.end ?? today}
          onChange={(event) => {
            reportState.end = event.target.value;
            onChange();
          }}
        />
      </label>
      {withPeriod ? (
        <label className="field">
          <span>Group by</span>
          <select
            className="input"
            value={reportState.period}
            onChange={(event) => {
              reportState.period = event.target.value as Period3;
              onChange();
            }}
          >
            {(["day", "week", "month"] as const).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}

function useRange(): [string, () => void] {
  const [version, setVersion] = useState(0);
  return [JSON.stringify(reportState) + String(version), () => setVersion((value) => value + 1)];
}

function Loading({ error }: { error: Error | null }) {
  return error ? <LoadError error={error} /> : <p className="muted">Loading</p>;
}

function MoneyReport() {
  const [key, bump] = useRange();
  const data = useResource(
    (signal) => get<Finance>("/api/reports/finance" + query({ period: reportState.period, start: reportState.start, end: reportState.end }), { signal }),
    [key],
    ["reports", "shop", "pantry", "plan"],
  );
  if (!data.data) return <Loading error={data.error} />;
  const report = data.data;
  const s = report.summary;
  const kpi = (value: ReactNode, label: ReactNode) => (
    <div className="kpi">
      <b className="num">{value}</b>
      <span>{label}</span>
    </div>
  );
  return (
    <>
      <Range withPeriod onChange={bump} />
      <div className="kpis">
        {kpi(money(s.spent), "spent")}
        {kpi(money(s.per_day), "per day")}
        {kpi(money(s.avg_meal_cost), "per cooked meal")}
        {kpi(money(s.waste), <>thrown away, {s.waste_share}%</>)}
        {kpi(s.trips, "shopping trips")}
      </div>
      <div className="report-grid">
        <section className="panel span-2">
          <h3>Spending</h3>
          {report.spending.length ? (
            <ChartBox
              config={{
                type: "bar",
                data: {
                  labels: report.spending.map((entry) => entry.bucket),
                  datasets: [
                    { label: "Spent", data: report.spending.map((entry) => entry.total), backgroundColor: SERIES[0], borderRadius: 6 },
                    {
                      label: "Cooked meals",
                      data: report.spending.map((entry) => report.meal_buckets.find((bucket) => bucket.bucket === entry.bucket)?.total ?? 0),
                      backgroundColor: SERIES[1],
                      borderRadius: 6,
                    },
                  ],
                },
                options: { scales: { y: euroTicks } },
              }}
            />
          ) : (
            <p className="muted">No purchases with prices in this range.</p>
          )}
        </section>
        <section className="panel">
          <h3>By store</h3>
          {report.stores.map((entry) => (
            <div key={entry.store} className="list-row">
              <span className="grow">
                {entry.store} <span className="muted">{entry.trips} trips</span>
              </span>
              <b className="num">{money(entry.total)}</b>
            </div>
          ))}
        </section>
        <section className="panel">
          <h3>By category</h3>
          {report.categories.length ? (
            <ChartBox
              height={220}
              config={{
                type: "doughnut",
                data: { labels: report.categories.map((entry) => entry.category), datasets: [{ data: report.categories.map((entry) => entry.total), backgroundColor: SERIES, borderWidth: 0 }] },
                options: { plugins: { legend: { display: true, position: "right" } }, cutout: "62%" },
              }}
            />
          ) : (
            <p className="muted">Nothing yet.</p>
          )}
        </section>
        <section className="panel">
          <h3>Where the money goes</h3>
          {report.top_items.map((entry) => (
            <div key={entry.id} className="list-row">
              <FoodIcon name={entry.icon} size="sm" />
              <span className="grow">
                <Names entity={entry} />
              </span>
              <span className="muted">{entry.purchases}x</span>
              <b className="num">{money(entry.total)}</b>
            </div>
          ))}
        </section>
        <section className="panel">
          <h3>Cost per dish</h3>
          {report.recipe_costs.length ? (
            report.recipe_costs.map((entry) => (
              <div key={entry.id} className="list-row">
                <span className="grow">
                  {entry.display} <span className="muted">{entry.times}x</span>
                </span>
                <span className="num soft">{money(entry.per_serving)} each</span>
                <b className="num">{money(entry.total)}</b>
              </div>
            ))
          ) : (
            <p className="muted">Cook something to see this.</p>
          )}
        </section>
        <section className="panel">
          <h3>Thrown away</h3>
          {report.waste_items.length ? (
            report.waste_items.map((entry) => (
              <div key={entry.id} className="list-row">
                <FoodIcon name={entry.icon} size="sm" />
                <span className="grow">{entry.display}</span>
                <span className="muted num">{qty(entry.qty, entry.unit)}</span>
                <b className="num bad">{money(entry.total)}</b>
              </div>
            ))
          ) : (
            <p className="muted">Nothing wasted in this range.</p>
          )}
        </section>
        <section className="panel span-2">
          <h3>Cooked meals</h3>
          {report.meals.length ? (
            report.meals.map((meal) => (
              <div key={meal.id} className="list-row">
                <span className="day-tag">{shortDate(meal.date)}</span>
                <span className="grow">
                  {meal.display} <span className="muted">for {trim(meal.servings, 1)}</span>
                </span>
                {meal.kcal ? <span className="muted num">{Math.round(meal.kcal)} kcal</span> : null}
                <b className="num">{money(meal.cost)}</b>
              </div>
            ))
          ) : (
            <p className="muted">No cooked meals yet.</p>
          )}
        </section>
      </div>
    </>
  );
}

function PricesReport() {
  const data = useResource((signal) => get<PriceTrend[]>("/api/reports/prices", { signal }), [], ["reports", "shop"]);
  if (!data.data) return <Loading error={data.error} />;
  if (!data.data.length) return <Empty icon="shopping-cart">Prices appear after your first shopping trip with prices entered.</Empty>;
  return (
    <div className="report-grid">
      {data.data.map((entry) => {
        const change = entry.change_pct;
        const first = entry.history[0];
        return (
          <section key={entry.id} className="panel">
            <div className="row">
              <FoodIcon name={entry.icon} />
              <div className="grow">
                <Names entity={entry} />
              </div>
              {change !== null ? <span className={"chip " + (change > 0 ? "bad" : change < 0 ? "good" : "")}>{(change > 0 ? "+" : "") + String(change) + "%"}</span> : null}
            </div>
            {entry.history.length > 1 ? (
              <ChartBox
                height={150}
                config={{
                  type: "line",
                  data: {
                    labels: entry.history.map((point) => shortDate(point.date)),
                    datasets: [{ label: entry.unit_label, data: entry.history.map((point) => point.unit_price), borderColor: SERIES[0], backgroundColor: SERIES[0], tension: 0.3, pointRadius: 3 }],
                  },
                  options: { plugins: { legend: { display: false } }, scales: { y: euroTicks } },
                }}
              />
            ) : first ? (
              <p className="soft num">
                {money(first.unit_price)} {entry.unit_label}
              </p>
            ) : null}
            <div className="row wrap" style={{ marginTop: "8px" }}>
              {entry.stores.map((store) => (
                <span key={store.store} className="chip">
                  {store.store} {money(store.avg)} {entry.unit_label}
                </span>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function NutritionReportView() {
  const [key, bump] = useRange();
  const data = useResource((signal) => get<NutritionReport>("/api/reports/nutrition" + query({ start: reportState.start, end: reportState.end }), { signal }), [key], ["reports", "plan"]);
  if (!data.data) return <Loading error={data.error} />;
  const report = data.data;
  const labels = report.days.map((day) => shortDate(day.date));
  return (
    <>
      <Range withPeriod={false} onChange={bump} />
      <p className="muted">
        Totals for everything cooked at home plus logged snacks, not per person.
        {report.incomplete_meals ? " " + String(report.incomplete_meals) + " meals are missing some nutrition data." : ""}
      </p>
      {!report.days.length ? (
        <Empty icon="green-salad">Cook a planned dish to start seeing this.</Empty>
      ) : (
        <div className="report-grid">
          <section className="panel span-2">
            <h3>Calories per day</h3>
            <ChartBox
              config={{
                type: "bar",
                data: {
                  labels,
                  datasets: [
                    { label: "Meals", data: report.days.map((day) => day.meal_kcal), backgroundColor: SERIES[0], borderRadius: 4, stack: "k" },
                    { label: "Snacks", data: report.days.map((day) => day.snack_kcal), backgroundColor: SERIES[2], borderRadius: 4, stack: "k" },
                  ],
                },
                options: { scales: { x: { stacked: true }, y: { stacked: true } } },
              }}
            />
          </section>
          <section className="panel span-2">
            <h3>Protein, fat and carbs per day</h3>
            <ChartBox
              config={{
                type: "line",
                data: {
                  labels,
                  datasets: [
                    { label: "Protein g", data: report.days.map((day) => day.protein), borderColor: SERIES[1], backgroundColor: SERIES[1], tension: 0.3 },
                    { label: "Fat g", data: report.days.map((day) => day.fat), borderColor: SERIES[2], backgroundColor: SERIES[2], tension: 0.3 },
                    { label: "Carbs g", data: report.days.map((day) => day.carbs), borderColor: SERIES[3], backgroundColor: SERIES[3], tension: 0.3 },
                  ],
                },
              }}
            />
          </section>
          <section className="panel span-2">
            <h3>Weekly</h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {["Week of", "Days", "kcal", "Protein", "Fat", "Carbs", "Fiber"].map((label) => (
                      <th key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.weeks.map((week) => (
                    <tr key={week.week}>
                      <td>{shortDate(week.week)}</td>
                      <td className="num">{week.days}</td>
                      {(["kcal", "protein", "fat", "carbs", "fiber"] as const).map((field) => (
                        <td key={field} className="num">
                          {Math.round(week[field])}
                          {field === "kcal" ? "" : " g"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function PlansReport() {
  const periods = useResource((signal) => get<Period[]>("/api/reports/periods", { signal }), [], ["reports", "shop"]);
  const [selected, setSelected] = useState<number | null>(reportState.periodId);
  const chosen = selected ?? periods.data?.[0]?.id ?? null;
  const report = useResource((signal) => (chosen === null ? Promise.resolve(null) : get<PeriodReport>("/api/reports/period/" + String(chosen), { signal })), [chosen], ["reports"]);
  if (!periods.data) return <Loading error={periods.error} />;
  if (!periods.data.length) return <Empty icon="tear-off-calendar">Build a shopping list from a plan to get a report when it ends.</Empty>;
  const detail = report.data;
  return (
    <>
      <select
        className="input"
        aria-label="Plan period"
        style={{ maxWidth: "340px" }}
        value={chosen ?? ""}
        onChange={(event) => {
          reportState.periodId = Number(event.target.value);
          setSelected(Number(event.target.value));
        }}
      >
        {periods.data.map((period) => (
          <option key={period.id} value={period.id}>
            {shortDate(period.range_start) + " to " + shortDate(period.range_end) + (period.status === "open" ? ", list open" : "")}
          </option>
        ))}
      </select>
      {detail ? (
        <div>
          <div className="kpis">
            <div className="kpi">
              <b className="num">
                {detail.cooked_meals} of {detail.planned_meals}
              </b>
              <span>planned meals cooked</span>
            </div>
            <div className="kpi">
              <b className="num">{detail.shortages.length}</b>
              <span>items ran short</span>
            </div>
            <div className="kpi">
              <b className="num">{detail.surplus.length}</b>
              <span>items left over</span>
            </div>
          </div>
          <div className="report-grid">
            <section className="panel">
              <h3>Ran short</h3>
              {detail.shortages.length ? (
                detail.shortages.map((line) => (
                  <div key={line.ingredient_id} className="list-row">
                    <FoodIcon name={line.icon} size="sm" />
                    <span className="grow">{line.display}</span>
                    <span className="bad num">{qty(line.short, line.unit)} missing</span>
                  </div>
                ))
              ) : (
                <p className="muted">Nothing ran out.</p>
              )}
            </section>
            <section className="panel">
              <h3>Left over</h3>
              {detail.surplus.length ? (
                detail.surplus.map((line) => (
                  <div key={line.ingredient_id} className="list-row">
                    <FoodIcon name={line.icon} size="sm" />
                    <span className="grow">{line.display}</span>
                    <span className="muted num">bought {qty(line.bought, line.unit)}</span>
                    <span className="num">{qty(line.left, line.unit)} left</span>
                  </div>
                ))
              ) : (
                <p className="muted">Nothing left over.</p>
              )}
            </section>
          </div>
        </div>
      ) : (
        <Loading error={report.error} />
      )}
    </>
  );
}

const TABS: [ReportTab, string][] = [
  ["money", "Money"],
  ["prices", "Prices"],
  ["nutrition", "Nutrition"],
  ["plans", "Plans"],
];

const EXPORTS = ["purchases", "meals", "snacks", "waste", "inventory", "recipes"];

export function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>(reportState.tab);
  return (
    <View route="reports" ready>
      {() => (
        <>
          <PageHead
            title="Reports"
            subtitle="Money, prices, nutrition and how each plan went."
            actions={
              <>
                <a className="btn" href="/api/export.xlsx" download>
                  <Icon name="download" />
                  Excel
                </a>
                <select
                  className="input"
                  aria-label="CSV export"
                  style={{ width: "auto" }}
                  value=""
                  onChange={(event) => {
                    if (event.target.value) window.location.href = "/api/export/" + event.target.value + ".csv";
                  }}
                >
                  <option value="">CSV export</option>
                  {EXPORTS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </>
            }
          />
          <div className="tabs" role="tablist" aria-label="Report">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => {
                  reportState.tab = key;
                  setTab(key);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="report-body">
            {tab === "money" ? <MoneyReport /> : tab === "prices" ? <PricesReport /> : tab === "nutrition" ? <NutritionReportView /> : <PlansReport />}
          </div>
        </>
      )}
    </View>
  );
}

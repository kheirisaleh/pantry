import { type ReactNode } from "react";
import { useNavigate } from "react-router";
import { usePath } from "@/app/mobile";
import { View } from "@/app/View";
import { changed } from "@/features/changed";
import { openIngredientSheet } from "@/features/ingredient";
import { get } from "@/lib/api";
import { shortDate } from "@/lib/format";
import { act } from "@/lib/offline";
import type { Alert } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { Empty, PageHead } from "@/ui/common";
import { toast } from "@/ui/toast";
import { reportState } from "./Reports";

export function AlertsPage() {
  const data = useResource((signal) => get<Alert[]>("/api/alerts", { signal }), [], ["alerts"]);
  const navigate = useNavigate();
  const path = usePath();
  const quiet = () => undefined;

  function actions(alert: Alert): ReactNode[] {
    const list: ReactNode[] = [];
    const button = (label: string, run: () => void, primary = false) => (
      <button key={label} type="button" className={"btn small" + (primary ? " primary" : "")} onClick={run}>
        {label}
      </button>
    );
    if (alert.kind === "missing")
      list.push(
        button(
          "Add to list",
          () => {
            act("POST", "/api/alerts/" + String(alert.id) + "/act").then(() => {
              toast("Added to the shopping list");
              changed();
            }, quiet);
          },
          true,
        ),
      );
    if (alert.kind === "tomorrow") list.push(button("Open plan", () => void navigate(path("plan"))));
    if (alert.kind === "period")
      list.push(
        button("See report", () => {
          reportState.tab = "plans";
          reportState.periodId = alert.payload.list_id ?? null;
          void navigate(path("reports"));
        }),
      );
    if (alert.kind === "stock_count") list.push(button("Open pantry", () => void navigate(path("pantry"))));
    if (alert.kind === "plan") list.push(button("Plan meals", () => void navigate(path("plan"))));
    const ingredientId = alert.payload.ingredient_id;
    if (alert.kind === "expiry" && ingredientId) list.push(button("Open item", () => void openIngredientSheet(ingredientId).catch(quiet)));
    list.push(
      <button
        key="dismiss"
        type="button"
        className="btn small ghost"
        onClick={() => {
          act("POST", "/api/alerts/" + String(alert.id) + "/dismiss").then(changed, quiet);
        }}
      >
        Dismiss
      </button>,
    );
    return list;
  }

  return (
    <View route="alerts" ready={Boolean(data.data)} error={data.error} onRetry={data.reload}>
      {() => (
        <>
          <PageHead title="Notes" subtitle="Things the pantry noticed. Dismissed notes do not come back." />
          {!data.data!.length ? (
            <Empty icon="teacup-without-handle">All quiet.</Empty>
          ) : (
            <div className="stack">
              {data.data!.map((alert) => (
                <article key={alert.id} className={"panel alert " + alert.kind}>
                  <div className="row">
                    <span className={"dot " + alert.kind} />
                    <h4 className="grow">{alert.title}</h4>
                    <span className="muted" style={{ fontSize: "var(--s-1)" }}>
                      {shortDate(alert.created_at)}
                    </span>
                  </div>
                  {alert.body ? (
                    <p className="soft" style={{ margin: "6px 0 10px 20px" }}>
                      {alert.body}
                    </p>
                  ) : null}
                  <div className="row wrap" style={{ marginLeft: "20px" }}>
                    {actions(alert)}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </View>
  );
}

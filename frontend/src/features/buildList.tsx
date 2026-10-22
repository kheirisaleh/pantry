import { useEffect, useState } from "react";
import { useToday } from "@/app/session";
import { get, query } from "@/lib/api";
import { addDays, parseNumber, qty, trim } from "@/lib/format";
import { act } from "@/lib/offline";
import type { CycleStatus, ReviewLine } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { FoodIcon, Names } from "@/ui/common";
import { openSheet, SheetLayout } from "@/ui/modal";
import { toast } from "@/ui/toast";
import { changed } from "./changed";

export function countChanges(lines: { ingredient_id: number; stock: number }[], typed: Record<number, string>): { ingredient_id: number; qty: number }[] {
  const changes: { ingredient_id: number; qty: number }[] = [];
  for (const line of lines) {
    const text = typed[line.ingredient_id];
    if (text === undefined) continue;
    const value = parseNumber(text);
    if (value !== null && Math.abs(value - line.stock) > 0.01) changes.push({ ingredient_id: line.ingredient_id, qty: value });
  }
  return changes;
}

function BuildBody({ close, onBuilt }: { close: () => void; onBuilt: () => void }) {
  const today = useToday();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(addDays(today, 13));
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const review = useResource((signal) => get<ReviewLine[]>("/api/shopping/review" + query({ start, end }), { signal }), [start, end]);

  useEffect(() => {
    const controller = new AbortController();
    get<CycleStatus>("/api/cycle", { signal: controller.signal }).then(
      (state) => {
        if (state.default_days) setEnd(addDays(today, state.default_days - 1));
      },
      () => undefined,
    );
    return () => {
      controller.abort();
    };
  }, [today]);

  async function build() {
    setBusy(true);
    try {
      const changes = countChanges(review.data ?? [], typed);
      if (changes.length) await act("POST", "/api/inventory/count", { entries: changes });
      await act("POST", "/api/shopping/build", { start, end });
      close();
      toast("Shopping list ready");
      changed();
      onBuilt();
    } catch {
      setBusy(false);
    }
  }

  let content;
  if (review.error) content = <p className="bad">{review.error.message}</p>;
  else if (!review.data || review.loading) content = <p className="muted">Loading</p>;
  else if (!review.data.length) content = <p className="muted">No planned dishes in this range.</p>;
  else
    content = (
      <>
        <p className="soft">Check what is really at home before the list is made. Fix any number that is off.</p>
        {review.data.map((line) => (
          <div key={line.ingredient_id} className="list-row">
            <FoodIcon name={line.icon} />
            <div className="grow">
              <Names entity={line} />
              <div className="muted" style={{ fontSize: "var(--s-1)" }}>
                Plan needs {qty(line.needed, line.unit)}
              </div>
            </div>
            <span className="muted">at home</span>
            <input
              className="input num"
              inputMode="decimal"
              aria-label={line.display + " at home"}
              style={{ width: "96px" }}
              value={typed[line.ingredient_id] ?? trim(line.stock, 1)}
              onChange={(event) => setTyped({ ...typed, [line.ingredient_id]: event.target.value })}
            />
            <span className="muted" style={{ width: "28px" }}>
              {line.unit}
            </span>
          </div>
        ))}
      </>
    );

  return (
    <SheetLayout
      title="Build the shopping list"
      onClose={close}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={() => void build()}>
            Build list
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="row wrap">
          <label className="field">
            <span>From</span>
            <input className="input" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label className="field">
            <span>To</span>
            <input className="input" type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>
        </div>
        <div className="stack">{content}</div>
      </div>
    </SheetLayout>
  );
}

export function openBuildListSheet(onBuilt: () => void): void {
  openSheet((close) => <BuildBody close={close} onBuilt={onBuilt} />, { wide: true, label: "Build the shopping list" });
}

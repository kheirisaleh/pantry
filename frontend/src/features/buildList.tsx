import { useEffect, useState } from "react";
import { useToday } from "@/app/session";
import { get, query } from "@/lib/api";
import { addDays, qty } from "@/lib/format";
import { type Countable, type CountDraft, countEntries, initialDraft } from "@/lib/count";
import { act } from "@/lib/offline";
import type { CycleStatus, ReviewLine } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { FoodIcon, Names } from "@/ui/common";
import { openSheet, SheetLayout } from "@/ui/modal";
import { toast } from "@/ui/toast";
import { changed } from "./changed";
import { CountField } from "./countField";

export function reviewCountable(line: ReviewLine): Countable {
  return { id: line.ingredient_id, unit: line.unit, stock: line.stock, piece_amount: line.piece_amount, package_amount: line.package_amount, package_estimate: line.package_estimate ?? null };
}

function BuildBody({ close, onBuilt }: { close: () => void; onBuilt: () => void }) {
  const today = useToday();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(addDays(today, 13));
  const [drafts, setDrafts] = useState<Record<number, CountDraft>>({});
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
      const items = (review.data ?? []).map(reviewCountable);
      const initial = Object.fromEntries(items.map((item) => [item.id, initialDraft(item, null)]));
      const { entries, error } = countEntries(items, initial, drafts);
      if (error) {
        toast(error, true);
        setBusy(false);
        return;
      }
      if (entries.length) await act("POST", "/api/inventory/count", { entries });
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
            <CountField
              item={reviewCountable(line)}
              label={line.display + " at home"}
              draft={drafts[line.ingredient_id] ?? initialDraft(reviewCountable(line), null)}
              onChange={(next) => setDrafts({ ...drafts, [line.ingredient_id]: next })}
            />
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

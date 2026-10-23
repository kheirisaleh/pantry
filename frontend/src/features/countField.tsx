import { trim } from "@/lib/format";
import { type Countable, type CountDraft, countUnits, estimatedSize, knownSize, needsSize } from "@/lib/count";
import type { ShopUnit } from "@/lib/types";

export function CountField({ item, label, draft, onChange }: { item: Countable; label: string; draft: CountDraft; onChange: (next: CountDraft) => void }) {
  const sized = needsSize(item.unit, draft.unit);
  const estimate = sized ? estimatedSize(item, draft.unit) : null;
  return (
    <div className="count-field">
      <div className="count-main">
        <input
          className="input num"
          inputMode="decimal"
          aria-label={label}
          value={draft.amount}
          onChange={(event) => onChange({ ...draft, amount: event.target.value })}
        />
        <select
          className="input unit-select count-unit"
          aria-label={"Unit for " + label}
          value={draft.unit}
          onChange={(event) => {
            const unit = event.target.value as ShopUnit;
            const size = knownSize(item, unit);
            onChange({ ...draft, unit, size: draft.size || (size ? trim(size, 1) : "") });
          }}
        >
          {countUnits(item.unit).map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
      </div>
      {sized ? (
        <div className="count-size muted">
          <span>{draft.unit === "pack" ? "1 pack =" : "1 pc ="}</span>
          <input
            className="input num"
            inputMode="decimal"
            aria-label={"Size of one " + (draft.unit === "pack" ? "pack" : "piece") + " for " + label}
            placeholder={estimate ? "≈" + trim(estimate, 0) : "?"}
            value={draft.size}
            onChange={(event) => onChange({ ...draft, size: event.target.value })}
          />
          <span>{item.unit}</span>
          {estimate && !draft.size ? (
            <button type="button" className="chip" onClick={() => onChange({ ...draft, size: trim(estimate, 1) })}>
              use about {trim(estimate, 0)} {item.unit}
            </button>
          ) : null}
        </div>
      ) : null}
      {sized && !draft.size.trim() ? <div className="count-note warn">Size unknown. Planning will not count this until you add the size from a label.</div> : null}
    </div>
  );
}

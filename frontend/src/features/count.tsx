import { useState } from "react";
import { type CountDraft, countEntries, initialDraft, rememberUnit } from "@/lib/count";
import { act } from "@/lib/offline";
import { grouped } from "@/lib/shopping";
import type { InventoryItem } from "@/lib/types";
import { IngredientIcon, Names } from "@/ui/common";
import { openSheet, SheetLayout } from "@/ui/modal";
import { toast } from "@/ui/toast";
import { changed } from "./changed";
import { CountField } from "./countField";

export function countable(items: InventoryItem[]): InventoryItem[] {
  return items.filter((item) => item.kind !== "staple" && (item.stock > 0 || item.kind === "food"));
}

function CountBody({ items, close }: { items: InventoryItem[]; close: () => void }) {
  const rows = countable(items);
  const [initial] = useState<Record<number, CountDraft>>(() => Object.fromEntries(rows.map((item) => [item.id, initialDraft(item)])));
  const [drafts, setDrafts] = useState<Record<number, CountDraft>>(initial);

  async function save() {
    const { entries, error } = countEntries(rows, initial, drafts);
    if (error) {
      toast(error, true);
      return;
    }
    await act("POST", "/api/inventory/count", { entries, full: true });
    for (const entry of entries) rememberUnit(entry.ingredient_id, entry.unit);
    close();
    toast("Pantry check saved");
    changed();
  }

  return (
    <SheetLayout
      title="Pantry check"
      onClose={close}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void save().catch(() => undefined)}>
            Save check
          </button>
        </>
      }
    >
      <div>
        <p className="soft">Go through the kitchen and fix any number that is wrong. Leave the rest.</p>
        {grouped(rows, (item) => item.category).map((group) => (
          <div key={group.category}>
            <div className="group-title">{group.category}</div>
            {group.items.map((item) => (
              <div key={item.id} className="list-row count-row">
                <IngredientIcon ingredient={item} />
                <div className="grow">
                  <Names entity={item} />
                </div>
                <CountField item={item} label={item.display + " at home"} draft={drafts[item.id] ?? initialDraft(item)} onChange={(next) => setDrafts({ ...drafts, [item.id]: next })} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </SheetLayout>
  );
}

export function openCountSheet(items: InventoryItem[]): void {
  openSheet((close) => <CountBody items={items} close={close} />, { wide: true, label: "Pantry check" });
}

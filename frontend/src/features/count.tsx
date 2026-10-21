import { useState } from "react";
import { trim } from "@/lib/format";
import { act } from "@/lib/offline";
import { grouped } from "@/lib/shopping";
import type { InventoryItem } from "@/lib/types";
import { IngredientIcon, Names } from "@/ui/common";
import { openSheet, SheetLayout } from "@/ui/modal";
import { toast } from "@/ui/toast";
import { countChanges } from "./buildList";
import { changed } from "./changed";

export function countable(items: InventoryItem[]): InventoryItem[] {
  return items.filter((item) => item.kind !== "staple" && (item.stock > 0 || item.kind === "food"));
}

function CountBody({ items, close }: { items: InventoryItem[]; close: () => void }) {
  const rows = countable(items);
  const [typed, setTyped] = useState<Record<number, string>>({});

  async function save() {
    const entries = countChanges(
      rows.map((item) => ({ ingredient_id: item.id, stock: item.stock })),
      typed,
    );
    await act("POST", "/api/inventory/count", { entries, full: true });
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
              <div key={item.id} className="list-row">
                <IngredientIcon ingredient={item} />
                <div className="grow">
                  <Names entity={item} />
                </div>
                <input
                  className="input num"
                  inputMode="decimal"
                  aria-label={item.display + " at home"}
                  style={{ width: "100px" }}
                  value={typed[item.id] ?? trim(item.stock, 1)}
                  onChange={(event) => setTyped({ ...typed, [item.id]: event.target.value })}
                />
                <span className="muted" style={{ width: "28px" }}>
                  {item.unit}
                </span>
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

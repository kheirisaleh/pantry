import { useState } from "react";
import { parseNumber } from "@/lib/format";
import { act } from "@/lib/offline";
import type { Unit } from "@/lib/types";
import { FoodIcon, IngredientIcon, Names } from "@/ui/common";
import { IngredientPicker, type Picked, UnitToggle } from "@/ui/controls";
import { openSheet, SheetLayout } from "@/ui/modal";
import { toast } from "@/ui/toast";
import { changed } from "./changed";

function SnackBody({ close }: { close: () => void }) {
  const [picked, setPicked] = useState<Picked | null>(null);
  const [amount, setAmount] = useState("1");
  const [unit, setUnit] = useState<Unit>("pcs");

  async function log() {
    if (!picked) {
      toast("Pick what you ate", true);
      return;
    }
    const value = parseNumber(amount);
    if (!value) {
      toast("Enter an amount", true);
      return;
    }
    await act("POST", "/api/snacks", { ingredient_id: picked.ingredient_id, name: picked.name, qty: value, unit });
    close();
    toast("Snack logged");
    changed();
  }

  return (
    <SheetLayout
      title="Log a snack"
      subtitle="Snacks count for nutrition but never change your meal plan."
      onClose={close}
      footer={
        <>
          <button type="button" className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void log().catch(() => undefined)}>
            Log snack
          </button>
        </>
      }
    >
      <div className="stack">
        <IngredientPicker placeholder="Apple, yogurt, maast, Apfel" autoFocus onPick={setPicked} />
        <div className="soft">
          {picked ? (
            <>
              {picked.ingredient ? <IngredientIcon ingredient={picked.ingredient} /> : <FoodIcon name="package" />} {picked.ingredient ? <Names entity={picked.ingredient} /> : picked.name}
            </>
          ) : (
            "Nothing picked yet"
          )}
        </div>
        <div className="row">
          <input className="input num" inputMode="decimal" aria-label="Amount" style={{ width: "110px" }} value={amount} onChange={(event) => setAmount(event.target.value)} />
          <UnitToggle<Unit> value={unit} onChange={setUnit} />
        </div>
      </div>
    </SheetLayout>
  );
}

export function openSnackSheet(): void {
  openSheet((close) => <SnackBody close={close} />, { label: "Log a snack" });
}

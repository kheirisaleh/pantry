import { useState } from "react";
import { View } from "@/app/View";
import { changed } from "@/features/changed";
import { openCountSheet } from "@/features/count";
import { openAdjustSheet, openIngredientSheet } from "@/features/ingredient";
import { get } from "@/lib/api";
import { qty, shortDate, trim } from "@/lib/format";
import { act } from "@/lib/offline";
import { grouped } from "@/lib/shopping";
import type { Ingredient, Inventory, InventoryItem } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { Empty, IngredientIcon, Names, PageHead } from "@/ui/common";
import { IngredientPicker } from "@/ui/controls";

export type PantryTab = "food" | "snack" | "household" | "staple" | "all";

export const PANTRY_TABS: [PantryTab, string][] = [
  ["food", "Ingredients"],
  ["snack", "Snacks"],
  ["household", "Household"],
  ["staple", "Basics"],
  ["all", "Everything known"],
];

let rememberedTab: PantryTab = "food";

export function shownItems(items: InventoryItem[], tab: PantryTab): InventoryItem[] {
  return items.filter((item) => {
    if (tab === "all") return true;
    if (item.kind !== tab) return false;
    return item.stock > 0 || item.pending_stock.length > 0;
  });
}

export function PantryPage() {
  const [tab, setTab] = useState<PantryTab>(rememberedTab);
  const data = useResource((signal) => get<Inventory>("/api/inventory", { signal }), [], ["pantry"]);
  return (
    <View route="pantry" ready={Boolean(data.data)} error={data.error} onRetry={data.reload}>
      {() => {
        const inventory = data.data!;
        const shown = shownItems(inventory.items, tab);
        return (
          <>
            <PageHead
              title="Pantry"
              subtitle={inventory.last_count ? "Last full check on " + shortDate(inventory.last_count) + "." : "No full check yet. Do one when you start."}
              actions={
                <button type="button" className="btn" onClick={() => openCountSheet(inventory.items)}>
                  Pantry check
                </button>
              }
            />
            <div className="pantry-add">
              <IngredientPicker
                placeholder="Add to the pantry: name in any language"
                onPick={(picked) => {
                  if (picked.ingredient) openAdjustSheet(picked.ingredient, "add", changed);
                  else
                    act<Ingredient>("POST", "/api/ingredients", { name: picked.name, kind: tab === "household" ? "household" : undefined }).then(
                      (created) => openAdjustSheet(created, "add", changed),
                      () => undefined,
                    );
                }}
              />
            </div>
            <div className="tabs" role="tablist" aria-label="Pantry sections">
              {PANTRY_TABS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => {
                    rememberedTab = key;
                    setTab(key);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="pantry-list">
              {!shown.length ? (
                <Empty icon="basket">{tab === "staple" ? "Salt, oil and spices live here. They are never counted in plans." : "Nothing here yet. Add what you have, or finish a shopping trip."}</Empty>
              ) : null}
              {grouped(shown, (item) => item.category).map((group) => (
                <div key={group.category}>
                  <div className="group-title">{group.category}</div>
                  {group.items.map((item) => (
                    <button key={item.id} type="button" className="list-row pantry-row" onClick={() => void openIngredientSheet(item.id).catch(() => undefined)}>
                      <IngredientIcon ingredient={item} size="lg" />
                      <div className="grow" style={{ textAlign: "left" }}>
                        <Names entity={item} />
                        <div className="row wrap" style={{ gap: "6px", marginTop: "2px" }}>
                          {item.status === "pending" ? <span className="chip warn">details on the way</span> : null}
                          {item.status === "unresolved" ? <span className="chip bad">not recognised</span> : null}
                          {item.expiring_estimate ? <span className="chip warn">use soon, roughly by {shortDate(item.expiring_estimate)}</span> : null}
                          {item.pending_stock.map((entry) => (
                            <span key={entry.unit} className="chip">
                              {trim(entry.qty, 1)} {entry.unit} waiting for conversion
                            </span>
                          ))}
                        </div>
                      </div>
                      <span className={"stock num" + (item.stock > 0 ? "" : " muted")}>{item.stock > 0 ? qty(item.stock, item.unit) : "none"}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>
        );
      }}
    </View>
  );
}

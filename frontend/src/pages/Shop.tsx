import { useRef, useState } from "react";
import { View } from "@/app/View";
import { openBuildListSheet } from "@/features/buildList";
import { activeSession, addItem, closeList, finishSession, loadShop, patchItem, pauseSession, removeItem, resumeSession, shopStore } from "@/features/shop";
import { openStoreSheet } from "@/features/storeSheet";
import { money, parseNumber, qty, shortDate, trim } from "@/lib/format";
import { amountHint, closeListMessage, defaultUnit, grouped, needText, priceText, sessionCount, sessionTotal } from "@/lib/shopping";
import { useStore } from "@/lib/store";
import type { ShopUnit, ShoppingItem, ShoppingList, ShoppingSession } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { Empty, IngredientIcon, Names, PageHead } from "@/ui/common";
import { IngredientPicker, ShopUnitSelect } from "@/ui/controls";
import { Icon } from "@/ui/icons";
import { confirmSheet } from "@/ui/modal";
import { toast } from "@/ui/toast";

const quiet = () => undefined;

function ShopRow({ item, list }: { item: ShoppingItem; list: ShoppingList }) {
  const ingredient = item.ingredient;
  const [unit, setUnit] = useState<ShopUnit>(() => defaultUnit(item));
  const [amount, setAmount] = useState(item.bought_qty ? trim(item.bought_qty, 2) : "");
  const [price, setPrice] = useState(priceText(item.price));
  const need = needText(item);
  const checked = Boolean(item.checked);

  function toggle() {
    const session = activeSession(list);
    if (!checked && !session) {
      openStoreSheet();
      return;
    }
    const data: Partial<ShoppingItem> = { checked: checked ? 0 : 1 };
    if (!checked && session) {
      data.session_id = session.id;
      if (!item.bought_qty) {
        const typed = parseNumber(amount);
        if (typed) {
          data.bought_qty = typed;
          data.bought_unit = unit;
        }
      }
    } else data.session_id = null;
    void patchItem(item, data).catch(quiet);
  }

  let source = null;
  if (!item.auto) {
    if (item.source === "alexa")
      source = (
        <span className="chip source-chip alexa">
          <Icon name="mic" />
          Alexa
        </span>
      );
    else if (item.source === "automation")
      source = (
        <span className="chip source-chip">
          <Icon name="link" />
          Automation
        </span>
      );
    else source = <span>added by hand</span>;
  }

  return (
    <div className={"shop-row" + (checked ? " is-checked" : "")}>
      <button type="button" className="check" role="checkbox" aria-checked={checked} aria-label={"Bought " + ingredient.display} onClick={toggle}>
        <Icon name="check" />
      </button>
      <IngredientIcon ingredient={ingredient} size="lg" />
      <div className="grow shop-name">
        <div>
          <Names entity={ingredient} />
        </div>
        <div className="muted shop-meta">
          {ingredient.name_de ? <span className="de">{ingredient.name_de}</span> : null}
          {need ? <span>need {need}</span> : null}
          {source}
        </div>
      </div>
      <div className="shop-inputs">
        <input
          className="input num"
          inputMode="decimal"
          aria-label={"Amount of " + ingredient.display + " bought"}
          placeholder={amountHint(item, unit)}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          onBlur={() => {
            const value = parseNumber(amount);
            if (value !== item.bought_qty) void patchItem(item, { bought_qty: value, bought_unit: unit }).catch(quiet);
          }}
        />
        <ShopUnitSelect<ShopUnit>
          className="input unit-select shop-unit"
          value={unit}
          onChange={(next) => {
            setUnit(next);
            if (next === "pack" && !ingredient.package_amount) toast("Set how much one pack holds in the details of " + ingredient.display + " so the pantry can count it");
            void patchItem(item, { bought_unit: next }).catch(quiet);
          }}
        />
        <input
          className="input num"
          inputMode="decimal"
          aria-label={"Price of " + ingredient.display}
          placeholder="€"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          onBlur={() => {
            const value = parseNumber(price);
            if (value !== null && value < 0) {
              toast("Price cannot be negative", true);
              return;
            }
            if (value !== item.price) void patchItem(item, { price: value }).catch(quiet);
          }}
        />
      </div>
      <button type="button" className="btn icon small ghost" aria-label={"Remove " + ingredient.display} onClick={() => void removeItem(item).catch(quiet)}>
        <Icon name="trash" />
      </button>
    </div>
  );
}

function SessionBar({ session, list }: { session: ShoppingSession; list: ShoppingList }) {
  const count = sessionCount(list, session.id);
  return (
    <div className="session-bar">
      <div className="grow">
        <div className="muted">
          At {session.store}, {count} item{count === 1 ? "" : "s"}
        </div>
        <div className="session-total num">{money(sessionTotal(list, session.id))}</div>
      </div>
      <button type="button" className="btn" onClick={() => void pauseSession(session).catch(quiet)}>
        Pause
      </button>
      <button type="button" className="btn primary" onClick={() => void finishSession(session).catch(quiet)}>
        Finish at this store
      </button>
    </div>
  );
}

export function ShopPage() {
  const data = useResource((signal) => loadShop(signal), [], ["shop"]);
  const list = useStore(shopStore);
  const adder = useRef<HTMLDivElement>(null);
  const focusAdder = () => {
    window.requestAnimationFrame(() => adder.current?.querySelector("input")?.focus());
  };

  return (
    <View route="shop" ready={data.data !== undefined} error={data.error} onRetry={data.reload}>
      {() => {
        const session = activeSession(list);
        const subtitle =
          list?.range_start && list.range_end ? "For meals from " + shortDate(list.range_start) + " to " + shortDate(list.range_end) + "." : "Add anything you need. Build from the planner to fill it from your meals.";
        const open = list ? list.items.filter((item) => !item.committed) : [];
        const done = list ? list.items.filter((item) => item.committed) : [];
        return (
          <>
            <PageHead
              title="Shopping"
              subtitle={subtitle}
              actions={
                <>
                  <button type="button" className="btn" onClick={() => openBuildListSheet(quiet)}>
                    Rebuild from plan
                  </button>
                  {session ? null : (
                    <button type="button" className="btn primary" onClick={() => openStoreSheet()}>
                      <Icon name="cart" />
                      Start shopping
                    </button>
                  )}
                </>
              }
            />
            <div className="shop-add" ref={adder}>
              <IngredientPicker
                placeholder="Add an item: panir, kiri, Milch, toilet paper"
                onPick={(picked) => {
                  void addItem(picked)
                    .then(focusAdder)
                    .catch(quiet);
                }}
              />
            </div>
            {!list?.items.length ? (
              <Empty icon="shopping-cart">
                <p>The list is empty.</p>
              </Empty>
            ) : (
              <>
                <div className="shop-list">
                  {grouped(open, (item) => item.ingredient.category).map((group) => (
                    <div key={group.category}>
                      <div className="group-title">{group.category}</div>
                      {group.items.map((item) => (
                        <ShopRow key={item.id} item={item} list={list} />
                      ))}
                    </div>
                  ))}
                </div>
                {done.length ? (
                  <details className="done-block">
                    <summary className="soft">{String(done.length) + " already in the pantry"}</summary>
                    {done.map((item) => (
                      <div key={item.id} className="list-row done">
                        <IngredientIcon ingredient={item.ingredient} size="sm" />
                        <span className="grow">{item.ingredient.display}</span>
                        <span className="muted num">{qty(item.bought_qty, item.bought_unit)}</span>
                        <span className="num">{money(item.price)}</span>
                      </div>
                    ))}
                  </details>
                ) : null}
                {list.sessions.length ? (
                  <div className="panel sessions">
                    <h4>Trips on this list</h4>
                    {list.sessions.map((entry) => (
                      <div key={entry.id} className="list-row">
                        <span className="grow">
                          {entry.store} <span className="muted">{entry.status === "finished" ? "finished" : entry.status === "active" ? "now" : "paused"}</span>
                        </span>
                        <b className="num">{money(entry.status === "finished" ? entry.total : sessionTotal(list, entry.id))}</b>
                        {entry.status === "paused" ? (
                          <button type="button" className="btn small" onClick={() => void resumeSession(entry).catch(quiet)}>
                            Resume
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {list.id ? (
                  <div className="row" style={{ justifyContent: "flex-end", marginTop: "18px" }}>
                    <button
                      type="button"
                      className="btn ghost danger"
                      onClick={() => {
                        void confirmSheet("Close this list?", closeListMessage(list), "Close list").then((ok) => (ok ? closeList(list).catch(quiet) : undefined));
                      }}
                    >
                      Close list
                    </button>
                  </div>
                ) : null}
              </>
            )}
            {session && list ? <SessionBar session={session} list={list} /> : null}
          </>
        );
      }}
    </View>
  );
}

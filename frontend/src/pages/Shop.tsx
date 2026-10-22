import { useEffect, useRef, useState } from "react";
import { View } from "@/app/View";
import { openBuildListSheet } from "@/features/buildList";
import { activeSession, addItem, closeList, finishSession, loadShop, patchItem, pauseSession, removeItem, resumeSession, shopStore } from "@/features/shop";
import { openStoreSheet } from "@/features/storeSheet";
import { money, parseNumber, qty, shortDate, trim } from "@/lib/format";
import { amountHint, closeListMessage, defaultPriceMode, defaultSize, defaultUnit, grouped, lineTotal, needsSize, needText, perLabel, type PriceMode, priceText, sessionCount, sessionTotal } from "@/lib/shopping";
import { useStore } from "@/lib/store";
import type { ShopUnit, ShoppingItem, ShoppingList, ShoppingSession } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { Empty, IngredientIcon, Names, PageHead } from "@/ui/common";
import { IngredientPicker, ShopUnitSelect } from "@/ui/controls";
import { Icon } from "@/ui/icons";
import { confirmSheet } from "@/ui/modal";
import { toast } from "@/ui/toast";

const quiet = () => undefined;

function amountText(item: ShoppingItem): string {
  return item.bought_qty ? trim(item.bought_qty, 2) : "";
}

function sizeText(item: ShoppingItem, unit: ShopUnit): string {
  const size = defaultSize(item, unit);
  return size ? trim(size, 1) : "";
}

function priceFor(item: ShoppingItem, mode: PriceMode): string {
  return priceText(mode === "each" ? item.unit_price : item.price);
}

function readNumber(text: string, label: string, allowZero = false): { ok: boolean; value: number | null } {
  if (!text.trim()) return { ok: true, value: null };
  const value = parseNumber(text);
  if (value === null || value < 0 || (!allowZero && value === 0)) {
    toast(label + " must be a number" + (allowZero ? "" : " above zero"), true);
    return { ok: false, value: null };
  }
  return { ok: true, value };
}

interface Draft {
  amount: string;
  unit: ShopUnit;
  size: string;
  price: string;
  mode: PriceMode;
}

function ShopRow({ item }: { item: ShoppingItem }) {
  const ingredient = item.ingredient;
  const [unit, setUnit] = useState<ShopUnit>(() => defaultUnit(item));
  const [mode, setMode] = useState<PriceMode>(() => defaultPriceMode(item, defaultUnit(item)));
  const [amount, setAmount] = useState(() => amountText(item));
  const [size, setSize] = useState(() => sizeText(item, defaultUnit(item)));
  const [price, setPrice] = useState(() => priceFor(item, defaultPriceMode(item, defaultUnit(item))));
  const editing = useRef(false);
  const need = needText(item);
  const checked = Boolean(item.checked);

  useEffect(() => {
    if (editing.current) return;
    const nextUnit = defaultUnit(item);
    const nextMode = defaultPriceMode(item, nextUnit);
    setUnit(nextUnit);
    setMode(nextMode);
    setAmount(amountText(item));
    setSize(sizeText(item, nextUnit));
    setPrice(priceFor(item, nextMode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.bought_qty, item.bought_unit, item.pack_size, item.price, item.unit_price]);

  function payload(draft: Draft): Partial<ShoppingItem> | null {
    const counted = readNumber(draft.amount.trim() ? draft.amount : amountHint(item, draft.unit), "Amount");
    const sized = needsSize(item, draft.unit) ? readNumber(draft.size, "Pack size") : { ok: true, value: null };
    const priced = readNumber(draft.price, "Price", true);
    if (!counted.ok) setAmount(amountText(item));
    if (!sized.ok) setSize(sizeText(item, draft.unit));
    if (!priced.ok) setPrice(priceFor(item, draft.mode));
    if (!counted.ok || !sized.ok || !priced.ok) return null;
    const data: Partial<ShoppingItem> = { bought_qty: counted.value, bought_unit: draft.unit, pack_size: sized.value };
    if (draft.mode === "each" && priced.value !== null) {
      data.unit_price = priced.value;
      data.price = lineTotal(priced.value, counted.value, draft.unit);
    } else {
      data.unit_price = null;
      data.price = priced.value;
    }
    return data;
  }

  function current(change: Partial<Draft> = {}): Draft {
    return { amount, unit, size, price, mode, ...change };
  }

  function same(data: Partial<ShoppingItem>): boolean {
    return (
      (data.bought_qty ?? null) === (item.bought_qty ?? null) &&
      (data.bought_unit ?? null) === (item.bought_unit ?? null) &&
      (data.pack_size ?? null) === (item.pack_size ?? null) &&
      (data.unit_price ?? null) === (item.unit_price ?? null) &&
      (data.price ?? null) === (item.price ?? null)
    );
  }

  function save(change: Partial<Draft> = {}) {
    const data = payload(current(change));
    if (data && !same(data)) void patchItem(item, data).catch(quiet);
  }

  function tick() {
    const session = activeSession(shopStore.get());
    if (!session) {
      openStoreSheet(tick);
      return;
    }
    const filled = amount.trim() ? amount : amountHint(item, unit);
    if (filled !== amount) setAmount(filled);
    const data = payload(current({ amount: filled }));
    if (!data) return;
    void patchItem(item, { ...data, checked: 1, session_id: session.id }).catch(quiet);
  }

  function toggle() {
    if (checked) void patchItem(item, { checked: 0, session_id: null }).catch(quiet);
    else tick();
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

  const sized = needsSize(item, unit);
  const counted = parseNumber(amount) ?? parseNumber(amountHint(item, unit));
  const each = mode === "each" ? parseNumber(price) : null;
  const total = each !== null ? lineTotal(each, counted, unit) : null;

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
          {item.unsure_stock?.length ? (
            <span className="warn">at home {item.unsure_stock.map((entry) => trim(entry.qty, 1) + " " + entry.unit).join(", ")}, size unknown</span>
          ) : null}
          {source}
        </div>
      </div>
      <div
        className="shop-inputs"
        onFocus={() => {
          editing.current = true;
        }}
        onBlur={() => {
          editing.current = false;
        }}
      >
        <div className="shop-fields">
          <input
            className="input num"
            inputMode="decimal"
            aria-label={"Amount of " + ingredient.display + " bought"}
            placeholder={amountHint(item, unit)}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            onBlur={() => save()}
          />
          <ShopUnitSelect<ShopUnit>
            className="input unit-select shop-unit"
            value={unit}
            onChange={(next) => {
              const nextSize = needsSize(item, next) ? size || sizeText(item, next) : "";
              setUnit(next);
              setSize(nextSize);
              save({ unit: next, size: nextSize });
            }}
          />
          <input
            className="input num"
            inputMode="decimal"
            aria-label={"Price of " + ingredient.display + (mode === "each" ? " " + perLabel(unit).replace("/", "per ") : " in total")}
            placeholder="€"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            onBlur={() => save()}
          />
          <button
            type="button"
            className="btn small ghost price-mode"
            aria-label={mode === "each" ? "Price is per unit, switch to total" : "Price is the total, switch to per unit"}
            onClick={() => {
              const next: PriceMode = mode === "each" ? "total" : "each";
              setMode(next);
              save({ mode: next });
            }}
          >
            {mode === "each" ? "€" + perLabel(unit) : "€ total"}
          </button>
        </div>
        {sized || (total !== null && (counted ?? 1) !== 1) ? (
          <div className="shop-extra muted">
            {sized ? (
              <label className="shop-size">
                <span>{unit === "pack" ? "1 pack =" : "1 pc ="}</span>
                <input
                  className="input num"
                  inputMode="decimal"
                  aria-label={"Size of one " + (unit === "pack" ? "pack" : "piece") + " of " + ingredient.display}
                  placeholder="?"
                  value={size}
                  onChange={(event) => setSize(event.target.value)}
                  onBlur={() => save()}
                />
                <span>{ingredient.unit}</span>
              </label>
            ) : null}
            {total !== null && (counted ?? 1) !== 1 ? <span className="num shop-line-total">= {money(total)}</span> : null}
          </div>
        ) : null}
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
                  {grouped(open, (item) => item.ingredient.category).flatMap((group) => [
                    <div key={"group-" + group.category} className="group-title">
                      {group.category}
                    </div>,
                    ...group.items.map((item) => <ShopRow key={item.id} item={item} />),
                  ])}
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

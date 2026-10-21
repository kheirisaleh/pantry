import { get } from "@/lib/api";
import { isQueued, mutate, readQueue } from "@/lib/offline";
import { emptyList, placeholderIngredient } from "@/lib/shopping";
import { storageGet, storageSet } from "@/lib/storage";
import { createStore } from "@/lib/store";
import { uid } from "@/lib/format";
import type { Id, IngredientRef, ShoppingItem, ShoppingList, ShoppingSession } from "@/lib/types";
import { toast } from "@/ui/toast";
import { changed } from "./changed";

export const shopStore = createStore<ShoppingList | null>(null);

function save(list: ShoppingList | null): void {
  shopStore.set(list);
  storageSet("shop", list);
}

function update(change: (list: ShoppingList) => ShoppingList): void {
  const current = shopStore.get() ?? emptyList();
  save(change(current));
}

export function accept(result: unknown): void {
  if (typeof result !== "object" || result === null || !("list" in result)) return;
  if (readQueue().length) return;
  save((result as { list: ShoppingList | null }).list);
}

export async function loadShop(signal?: AbortSignal): Promise<ShoppingList | null> {
  const data = await get<{ list: ShoppingList | null }>("/api/shopping", signal ? { signal } : {});
  if (!readQueue().length) save(data.list);
  else shopStore.set(storageGet<ShoppingList | null>("shop", null) ?? data.list);
  return shopStore.get();
}

export function activeSession(list: ShoppingList | null): ShoppingSession | null {
  return list?.active_session ?? null;
}

export async function startSession(store: string): Promise<void> {
  const name = store.trim() || "Store";
  const temp = "tmp-s-" + uid();
  const result = await mutate<{ session_id: number; list: ShoppingList }>("POST", "/api/shopping/sessions", { store: name }, { offline: true, temp });
  if (isQueued(result)) {
    update((list) => {
      const session: ShoppingSession = { id: temp, store: name, status: "active", total: 0 };
      return {
        ...list,
        sessions: list.sessions.map((entry): ShoppingSession => ({ ...entry, status: entry.status === "active" ? "paused" : entry.status })).concat([session]),
        active_session: session,
      };
    });
  } else accept(result);
}

export async function patchItem(item: ShoppingItem, data: Partial<ShoppingItem> & { session_id?: Id | null }): Promise<void> {
  update((list) => ({ ...list, items: list.items.map((entry) => (entry.id === item.id ? { ...entry, ...data } : entry)) }));
  const result = await mutate<{ list: ShoppingList }>("PATCH", "/api/shopping/items/" + String(item.id), data, { offline: true });
  if (isQueued(result)) return;
  const fresh = result.list.items.find((entry) => entry.id === item.id);
  update((list) => ({
    ...list,
    items: list.items.map((entry) => (entry.id === item.id && fresh ? { ...entry, session_id: fresh.session_id } : entry)),
    ...(readQueue().length ? {} : { sessions: result.list.sessions, active_session: result.list.active_session }),
  }));
}

export async function removeItem(item: ShoppingItem): Promise<void> {
  update((list) => ({ ...list, items: list.items.filter((entry) => entry.id !== item.id) }));
  accept(await mutate("DELETE", "/api/shopping/items/" + String(item.id), undefined, { offline: true }));
}

export async function addItem(picked: { ingredient_id?: number; ingredient?: IngredientRef; name: string }): Promise<void> {
  const session = activeSession(shopStore.get());
  const body: Record<string, unknown> = { ingredient_id: picked.ingredient_id, name: picked.name };
  if (session) {
    body.checked = true;
    body.session_id = session.id;
  }
  const temp = "tmp-i-" + uid();
  const result = await mutate("POST", "/api/shopping/items", body, { offline: true, temp });
  if (isQueued(result)) {
    update((list) => ({
      ...list,
      items: [
        ...list.items,
        {
          id: temp,
          auto: 0,
          checked: session ? 1 : 0,
          committed: 0,
          session_id: session ? session.id : null,
          needed_qty: null,
          price: null,
          bought_qty: null,
          ingredient: picked.ingredient ?? placeholderIngredient(picked.name),
        },
      ],
    }));
  } else accept(result);
}

export async function pauseSession(session: ShoppingSession): Promise<void> {
  accept(await mutate("POST", "/api/shopping/sessions/" + String(session.id) + "/pause", undefined, { offline: true }));
  update((list) => ({ ...list, active_session: null }));
}

export async function resumeSession(session: ShoppingSession): Promise<void> {
  accept(await mutate("POST", "/api/shopping/sessions/" + String(session.id) + "/resume"));
}

export async function finishSession(session: ShoppingSession): Promise<void> {
  const result = await mutate("POST", "/api/shopping/sessions/" + String(session.id) + "/finish", undefined, { offline: true });
  if (isQueued(result)) {
    update((list) => ({
      ...list,
      items: list.items.map((item) => (item.checked && String(item.session_id) === String(session.id) ? { ...item, committed: 1 } : item)),
      sessions: list.sessions.map((entry) => (entry.id === session.id ? { ...entry, status: "finished" } : entry)),
      active_session: null,
    }));
    toast("Saved here. It will reach the pantry when you are back online.");
  } else {
    accept(result);
    toast("Trip saved to the pantry");
    changed();
  }
}

export async function closeList(list: ShoppingList): Promise<void> {
  if (list.id === null) return;
  await mutate("POST", "/api/shopping/" + String(list.id) + "/close");
  toast("List closed");
  storageSet("shop", null);
  changed();
}

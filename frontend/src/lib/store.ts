import { useSyncExternalStore } from "react";

export interface Store<T> {
  get: () => T;
  set: (next: T | ((current: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      value = typeof next === "function" ? (next as (current: T) => T)(value) : next;
      listeners.forEach((listener) => {
        listener();
      });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export const TAGS = ["boot", "plan", "recipes", "pantry", "shop", "alerts", "reports", "settings"] as const;
export type Tag = (typeof TAGS)[number];

const versions = createStore<Record<Tag, number>>({ boot: 0, plan: 0, recipes: 0, pantry: 0, shop: 0, alerts: 0, reports: 0, settings: 0 });

export function invalidate(...tags: Tag[]): void {
  versions.set((current) => {
    const next = { ...current };
    for (const tag of tags) next[tag] += 1;
    return next;
  });
}

export function invalidateAll(): void {
  invalidate(...TAGS);
}

export function useTagVersion(tags: readonly Tag[]): string {
  const current = useStore(versions);
  return tags.map((tag) => current[tag]).join(".");
}

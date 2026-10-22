import { get, setApiUser } from "@/lib/api";
import { iso } from "@/lib/format";
import { startSync } from "@/lib/offline";
import { storageGet, storageSet } from "@/lib/storage";
import { createStore, invalidate, useStore } from "@/lib/store";
import type { Boot, User } from "@/lib/types";

export type BootState = { kind: "loading" } | { kind: "failed"; message: string } | { kind: "ready" };

export const bootState = createStore<BootState>({ kind: "loading" });
export const bootStore = createStore<Boot | null>(null);
export const userStore = createStore<User | null>(null);

export function useBootState(): BootState {
  return useStore(bootState);
}

export function useBoot(): Boot {
  const boot = useStore(bootStore);
  if (!boot) throw new Error("Pantry has not loaded yet");
  return boot;
}

export function useUser(): User | null {
  return useStore(userStore);
}

export function useToday(): string {
  return useStore(bootStore)?.today ?? iso(new Date());
}

export function setUser(user: User | null): void {
  userStore.set(user);
  setApiUser(user?.id ?? null);
  storageSet("user", user?.id ?? null);
}

export async function refreshBoot(): Promise<Boot | null> {
  try {
    const boot = await get<Boot>("/api/bootstrap");
    bootStore.set(boot);
    storageSet("boot", boot);
    const current = userStore.get();
    if (current) {
      const fresh = boot.users.find((user) => user.id === current.id) ?? null;
      if (fresh && (fresh.name !== current.name || fresh.color !== current.color)) setUser(fresh);
    }
    invalidate("boot");
    return boot;
  } catch {
    return bootStore.get();
  }
}

let stopSync: (() => void) | null = null;

export async function boot(): Promise<void> {
  let loaded: Boot | null;
  try {
    loaded = await get<Boot>("/api/bootstrap");
    storageSet("boot", loaded);
  } catch (error) {
    loaded = storageGet<Boot | null>("boot", null);
    if (!loaded) {
      bootState.set({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
      return;
    }
  }
  bootStore.set(loaded);
  const saved = storageGet<number | null>("user", null);
  setUser(loaded.users.find((user) => user.id === saved) ?? null);
  stopSync?.();
  stopSync = startSync();
  if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null);
  bootState.set({ kind: "ready" });
}

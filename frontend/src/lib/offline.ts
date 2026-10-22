import { ApiError, getApiUser, type Method, network, send, setApiUser, setOnline } from "./api";
import { uid } from "./format";
import { storageGet, storageSet } from "./storage";
import { createStore, invalidateAll } from "./store";

export interface QueueEntry {
  method: Method;
  path: string;
  body?: unknown;
  opId: string;
  temp?: string;
  user?: number | null;
}

export interface MutateOptions {
  offline?: boolean;
  temp?: string;
}

export interface Queued {
  queued: true;
}

type Notifier = (message: string, bad: boolean) => void;

let notify: Notifier = () => undefined;

export const pending = createStore<number>(0);

export function setNotifier(callback: Notifier): void {
  notify = callback;
}

export function readQueue(): QueueEntry[] {
  return storageGet<QueueEntry[]>("queue", []);
}

function writeQueue(items: QueueEntry[]): void {
  storageSet("queue", items);
  pending.set(items.length);
}

export function enqueue(entry: QueueEntry): void {
  writeQueue([...readQueue(), entry]);
}

export function isQueued(value: unknown): value is Queued {
  return typeof value === "object" && value !== null && "queued" in value;
}

export function rewrite(entry: QueueEntry, temps: Record<string, Id>): { path: string; body: unknown; skip: boolean } {
  let path = entry.path;
  for (const [temp, real] of Object.entries(temps)) path = path.split(temp).join(String(real));
  let body = entry.body;
  if (body && typeof body === "object" && "session_id" in body) {
    const sessionId = body.session_id;
    if (typeof sessionId === "string" && sessionId in temps) body = { ...body, session_id: temps[sessionId] };
  }
  return { path, body, skip: path.includes("/tmp-") };
}

type Id = number | string;

export function realId(result: unknown): Id | null {
  if (typeof result !== "object" || result === null) return null;
  const value = result as { item_id?: Id; session_id?: Id };
  return value.item_id ?? value.session_id ?? null;
}

export const OFFLINE_TIMEOUT_MS = 12000;

export async function mutate<T>(method: Method, path: string, body?: unknown, options: MutateOptions = {}): Promise<T | Queued> {
  const opId = uid();
  const entry: QueueEntry = { method, path, body, opId, user: getApiUser(), ...(options.temp ? { temp: options.temp } : {}) };
  if (options.offline && readQueue().length) {
    enqueue(entry);
    if (network.get().online) void flush();
    return { queued: true };
  }
  try {
    return await send<T>(method, path, body, opId, options.offline ? OFFLINE_TIMEOUT_MS : undefined);
  } catch (error) {
    if (error instanceof ApiError) {
      notify(error.message, true);
      throw error;
    }
    setOnline(false);
    if (options.offline) {
      enqueue(entry);
      return { queued: true };
    }
    notify("You are offline. Try again when connected.", true);
    throw error;
  }
}

export async function act<T>(method: Method, path: string, body?: unknown): Promise<T> {
  return (await mutate<T>(method, path, body)) as T;
}

let flushing = false;

function drop(entry: QueueEntry): void {
  writeQueue(readQueue().filter((item) => item.opId !== entry.opId));
}

export async function flush(): Promise<void> {
  if (flushing) return;
  if (!readQueue().length) return;
  flushing = true;
  const temps = storageGet<Record<string, Id>>("temps", {});
  try {
    for (let entry = readQueue()[0]; entry; entry = readQueue()[0]) {
      const { path, body, skip } = rewrite(entry, temps);
      if (skip) {
        drop(entry);
        continue;
      }
      const previous = getApiUser();
      if (entry.user !== undefined) setApiUser(entry.user ?? previous);
      let result: unknown;
      try {
        result = await send(entry.method, path, body, entry.opId);
      } catch (error) {
        setApiUser(previous);
        if (error instanceof ApiError) {
          notify("A saved change could not be applied: " + error.message, true);
          drop(entry);
          continue;
        }
        throw error;
      }
      setApiUser(previous);
      if (entry.temp) {
        const real = realId(result);
        if (real !== null) temps[entry.temp] = real;
        storageSet("temps", temps);
      }
      drop(entry);
    }
    storageSet("temps", {});
    invalidateAll();
  } catch {
    setOnline(false);
  } finally {
    flushing = false;
  }
}

export function startSync(): () => void {
  pending.set(readQueue().length);
  const onOnline = () => {
    setOnline(true);
    void flush();
  };
  const onOffline = () => {
    setOnline(false);
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  const stop = network.subscribe(() => {
    if (network.get().online) void flush();
  });
  const timer = window.setInterval(() => {
    if (readQueue().length) void flush();
  }, 15000);
  void flush();
  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.clearInterval(timer);
    stop();
  };
}

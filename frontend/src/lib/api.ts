import { createStore } from "./store";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface ClientState {
  userId: number | null;
}

const client: ClientState = { userId: null };

export const network = createStore<{ online: boolean }>({ online: typeof navigator === "undefined" ? true : navigator.onLine });

export function setOnline(online: boolean): void {
  if (network.get().online !== online) network.set({ online });
}

export function setApiUser(userId: number | null): void {
  client.userId = userId;
}

export function getApiUser(): number | null {
  return client.userId;
}

export function headers(extra: Record<string, string> = {}): Record<string, string> {
  const result: Record<string, string> = { "Content-Type": "application/json", ...extra };
  if (client.userId !== null) result["X-User-Id"] = String(client.userId);
  return result;
}

export async function errorText(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: unknown; detail?: unknown };
    if (typeof data.error === "string") return data.error;
    if (typeof data.detail === "string") return data.detail;
  } catch {
    return "Request failed (" + String(response.status) + ")";
  }
  return "Request failed (" + String(response.status) + ")";
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function cached<T>(path: string): Promise<T | undefined> {
  if (typeof caches === "undefined") return undefined;
  try {
    const match = await caches.match(new URL(path, window.location.origin).toString(), { ignoreVary: true });
    if (match) return (await match.json()) as T;
  } catch {
    return undefined;
  }
  return undefined;
}

export async function get<T>(path: string, options: { signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { headers: headers(), cache: "no-store", signal: options.signal ?? null });
  } catch (error) {
    if (isAbort(error)) throw error;
    setOnline(false);
    const fallback = await cached<T>(path);
    if (fallback !== undefined) return fallback;
    throw new ApiError("You are offline and this page has not been loaded before.", 0);
  }
  if (!response.ok) throw new ApiError(await errorText(response), response.status);
  setOnline(true);
  return (await response.json()) as T;
}

export class TimeoutError extends Error {
  constructor() {
    super("The server did not answer in time");
    this.name = "TimeoutError";
  }
}

export async function send<T>(method: Method, path: string, body: unknown, opId: string, timeoutMs?: number): Promise<T> {
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : undefined;
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: headers({ "X-Op-Id": opId }),
      body: body === undefined ? null : JSON.stringify(body),
      signal: controller?.signal ?? null,
    });
  } catch (error) {
    if (controller?.signal.aborted) throw new TimeoutError();
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
  if (!response.ok) throw new ApiError(await errorText(response), response.status);
  setOnline(true);
  return (await response.json()) as T;
}

export function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === false || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? "?" + text : "";
}

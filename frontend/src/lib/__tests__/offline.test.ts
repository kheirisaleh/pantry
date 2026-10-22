import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { network, setApiUser } from "../api";
import { act, flush, isQueued, mutate, pending, readQueue, realId, rewrite, setNotifier } from "../offline";
import { storageGet } from "../storage";

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const notes: [string, boolean][] = [];

beforeEach(() => {
  notes.length = 0;
  setNotifier((message, bad) => notes.push([message, bad]));
  network.set({ online: true });
});

afterEach(() => {
  setApiUser(null);
});

describe("offline queue", () => {
  it("replaces temporary ids", () => {
    expect(rewrite({ method: "PATCH", path: "/api/shopping/items/tmp-i-1", opId: "a" }, { "tmp-i-1": 7 })).toEqual({ path: "/api/shopping/items/7", body: undefined, skip: false });
    expect(rewrite({ method: "POST", path: "/api/shopping/items", body: { session_id: "tmp-s-1" }, opId: "a" }, { "tmp-s-1": 3 }).body).toEqual({ session_id: 3 });
    expect(rewrite({ method: "DELETE", path: "/api/shopping/items/tmp-i-2", opId: "a" }, {}).skip).toBe(true);
    expect(realId({ item_id: 5 })).toBe(5);
    expect(realId({ session_id: 6 })).toBe(6);
    expect(realId(null)).toBeNull();
  });

  it("queues offline-capable changes when the network is down and replays them in order", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const started = await mutate("POST", "/api/shopping/sessions", { store: "Rewe" }, { offline: true, temp: "tmp-s-1" });
    expect(isQueued(started)).toBe(true);
    await mutate("POST", "/api/shopping/items", { name: "milk", session_id: "tmp-s-1" }, { offline: true, temp: "tmp-i-1" });
    await mutate("PATCH", "/api/shopping/items/tmp-i-1", { price: 1 }, { offline: true });
    expect(readQueue()).toHaveLength(3);
    expect(pending.get()).toBe(3);
    expect(network.get().online).toBe(false);

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(respond(200, { session_id: 11 }))
      .mockResolvedValueOnce(respond(200, { item_id: 22 }))
      .mockResolvedValueOnce(respond(200, { list: null }));
    await flush();
    const calls = fetchMock.mock.calls.map((call) => [call[0], call[1]?.body]);
    expect(calls).toEqual([
      ["/api/shopping/sessions", '{"store":"Rewe"}'],
      ["/api/shopping/items", '{"name":"milk","session_id":11}'],
      ["/api/shopping/items/22", '{"price":1}'],
    ]);
    expect(readQueue()).toEqual([]);
    expect(storageGet("temps", null)).toEqual({});
  });

  it("drops changes the server refuses and tells the user", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("offline")).mockResolvedValueOnce(respond(400, { error: "Item not found" }));
    await mutate("DELETE", "/api/shopping/items/4", undefined, { offline: true });
    await flush();
    expect(readQueue()).toEqual([]);
    expect(notes).toEqual([["A saved change could not be applied: Item not found", true]]);
  });

  it("shows server errors and does not queue them", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(respond(400, { error: "Price cannot be negative" }));
    await expect(act("PATCH", "/api/shopping/items/1", { price: -1 })).rejects.toThrow("Price cannot be negative");
    expect(notes).toEqual([["Price cannot be negative", true]]);
    expect(readQueue()).toEqual([]);
  });

  it("does not queue normal changes made offline", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    await expect(act("POST", "/api/meals", {})).rejects.toThrow();
    expect(notes[0]?.[0]).toBe("You are offline. Try again when connected.");
    expect(readQueue()).toEqual([]);
  });

  it("replays as the person who made the change", async () => {
    setApiUser(2);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("offline"));
    await mutate("POST", "/api/shopping/items", { name: "x" }, { offline: true });
    setApiUser(1);
    fetchMock.mockResolvedValueOnce(respond(200, { item_id: 1 }));
    await flush();
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ "X-User-Id": "2" });
  });
  it("keeps changes made while the queue is being replayed", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await mutate("PATCH", "/api/shopping/items/1", { checked: 1 }, { offline: true });
    fetchMock.mockReset();
    let release: (value: Response) => void = () => undefined;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve))).mockResolvedValue(respond(200, { list: null }));
    network.set({ online: false });
    const running = flush();
    await mutate("PATCH", "/api/shopping/items/2", { checked: 1 }, { offline: true });
    release(respond(200, { list: null }));
    await running;
    await flush();
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/api/shopping/items/1", "/api/shopping/items/2"]);
    expect(readQueue()).toEqual([]);
  });

  it("queues a change when the server does not answer in time", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(globalThis, "fetch").mockImplementation(
        (_input, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
      );
      const result = mutate("PATCH", "/api/shopping/items/3", { price: 2 }, { offline: true });
      await vi.advanceTimersByTimeAsync(13000);
      expect(isQueued(await result)).toBe(true);
      expect(readQueue()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

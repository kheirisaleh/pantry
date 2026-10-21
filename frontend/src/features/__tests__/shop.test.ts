import { beforeEach, describe, expect, it, vi } from "vitest";
import { network } from "@/lib/api";
import { readQueue, setNotifier } from "@/lib/offline";
import { addItem, finishSession, loadShop, patchItem, shopStore, startSession } from "../shop";

function respond(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 });
}

beforeEach(() => {
  shopStore.set(null);
  network.set({ online: true });
  setNotifier(() => undefined);
});

describe("shop state", () => {
  it("keeps working in the store without a network", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    await startSession("Aldi");
    const session = shopStore.get()?.active_session;
    expect(session?.store).toBe("Aldi");
    expect(String(session?.id)).toMatch(/^tmp-s-/);
    await addItem({ name: "milk" });
    const item = shopStore.get()?.items[0];
    expect(item?.ingredient.display).toBe("milk");
    expect(item?.checked).toBe(1);
    expect(item?.session_id).toBe(session?.id);
    await patchItem(item!, { price: 1.19 });
    expect(shopStore.get()?.items[0]?.price).toBe(1.19);
    await finishSession(session!);
    expect(shopStore.get()?.items[0]?.committed).toBe(1);
    expect(shopStore.get()?.active_session).toBeNull();
    expect(readQueue().map((entry) => entry.method + " " + entry.path)).toEqual([
      "POST /api/shopping/sessions",
      "POST /api/shopping/items",
      expect.stringMatching(/^PATCH \/api\/shopping\/items\/tmp-i-/),
      expect.stringMatching(/^POST \/api\/shopping\/sessions\/tmp-s-.*\/finish$/),
    ]);
  });

  it("prefers the local list while changes wait", async () => {
    window.localStorage.setItem("pantry:queue", JSON.stringify([{ method: "POST", path: "/x", opId: "1" }]));
    window.localStorage.setItem("pantry:shop", JSON.stringify({ id: 1, status: "open", items: [], sessions: [], active_session: null, range_start: "local" }));
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(respond({ list: { id: 1, status: "open", items: [], sessions: [], active_session: null, range_start: "server" } })));
    expect((await loadShop())?.range_start).toBe("local");
    window.localStorage.removeItem("pantry:queue");
    expect((await loadShop())?.range_start).toBe("server");
  });
});

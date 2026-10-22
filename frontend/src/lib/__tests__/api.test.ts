import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, errorText, get, headers, network, query, send, setApiUser } from "../api";

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  setApiUser(null);
  network.set({ online: true });
});

describe("api", () => {
  it("sends the user and the operation id", async () => {
    setApiUser(3);
    expect(headers()).toEqual({ "Content-Type": "application/json", "X-User-Id": "3" });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(respond(200, { ok: true }));
    await send("POST", "/api/x", { a: 1 }, "op-1");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.headers).toMatchObject({ "X-Op-Id": "op-1", "X-User-Id": "3" });
    expect(init?.body).toBe('{"a":1}');
  });

  it("turns error bodies into messages", async () => {
    expect(await errorText(respond(400, { error: "Name is required" }))).toBe("Name is required");
    expect(await errorText(respond(422, { detail: "Bad" }))).toBe("Bad");
    expect(await errorText(new Response("oops", { status: 500 }))).toBe("Request failed (500)");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(respond(404, { error: "Recipe not found" }));
    await expect(get("/api/recipes/9")).rejects.toEqual(new ApiError("Recipe not found", 404));
  });

  it("marks the app offline when the network fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(get("/api/shopping")).rejects.toMatchObject({ status: 0 });
    expect(network.get().online).toBe(false);
  });

  it("does not treat aborted requests as offline", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("aborted", "AbortError"));
    await expect(get("/api/shopping")).rejects.toHaveProperty("name", "AbortError");
    expect(network.get().online).toBe(true);
  });

  it("builds query strings without empty values", () => {
    expect(query({ start: "2026-01-01", end: null, user: 0, flag: false, q: "" })).toBe("?start=2026-01-01&user=0");
    expect(query({})).toBe("");
  });
});

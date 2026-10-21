import { type APIRequestContext, expect, type Page } from "@playwright/test";

export async function signIn(page: Page, userId = 1): Promise<void> {
  await page.addInitScript((id) => {
    window.localStorage.setItem("pantry:user", String(id));
  }, userId);
}

export async function assistantDone(request: APIRequestContext): Promise<void> {
  await expect
    .poll(async () => {
      const status = (await (await request.get("/api/ai")).json()) as { queued: number };
      return status.queued;
    })
    .toBe(0);
}

export async function createDish(request: APIRequestContext, name: string, items: [string, number, string][]): Promise<number> {
  const response = await request.post("/api/recipes", {
    headers: { "X-User-Id": "1" },
    data: { name, slots: items.map(([item, amount, unit]) => ({ items: [{ name: item, amount, unit }] })) },
  });
  expect(response.ok()).toBeTruthy();
  const recipe = (await response.json()) as { id: number };
  await assistantDone(request);
  return recipe.id;
}

export async function addStock(request: APIRequestContext, name: string, qty: number, unit: string, price?: number): Promise<void> {
  const response = await request.post("/api/inventory/add", { headers: { "X-User-Id": "1" }, data: { name, qty, unit, price } });
  expect(response.ok()).toBeTruthy();
  await assistantDone(request);
}

export async function today(request: APIRequestContext): Promise<string> {
  return ((await (await request.get("/api/bootstrap")).json()) as { today: string }).today;
}

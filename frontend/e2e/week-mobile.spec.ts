import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { createDish, signIn, today } from "./helpers";

const H = { "X-User-Id": "1" };

async function stockOf(request: APIRequestContext, display: string): Promise<number> {
  const inventory = (await (await request.get("/api/inventory")).json()) as { items: { display: string; stock: number }[] };
  return inventory.items.find((item) => item.display === display)?.stock ?? 0;
}

async function startTrip(page: Page, store: string): Promise<void> {
  await page.getByRole("button", { name: "Start shopping" }).click();
  const sheet = page.getByRole("dialog", { name: "Where are you shopping?" });
  await sheet.getByLabel("Store").fill(store);
  await sheet.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".session-bar")).toContainText("At " + store);
}

test("a whole week on the phone: plan, shop at two stores with a dead spot, cook, snack and throw away", async ({ page, context, request }) => {
  const open = (await (await request.get("/api/shopping")).json()) as { list: { id: number } | null };
  if (open.list) await request.post("/api/shopping/" + String(open.list.id) + "/close", { headers: H });

  const dish = await createDish(request, "lentil rice", [
    ["rice", 150, "g"],
    ["lentils", 100, "g"],
  ]);
  const inventory = (await (await request.get("/api/inventory")).json()) as { items: { id: number; display: string }[] };
  const entries = inventory.items.filter((item) => item.display === "Basmati rice" || item.display === "Red lentils").map((item) => ({ ingredient_id: item.id, qty: 0 }));
  await request.post("/api/inventory/count", { headers: H, data: { entries } });
  const day = await today(request);
  await request.post("/api/meals", { headers: H, data: { date: day, recipe_id: dish, servings: 2 } });
  const riceBefore = await stockOf(request, "Basmati rice");
  const lentilsBefore = await stockOf(request, "Red lentils");
  const eggsBefore = await stockOf(request, "Eggs");
  const end = new Date(day + "T00:00:00");
  end.setDate(end.getDate() + 6);
  await request.post("/api/shopping/build", { headers: H, data: { start: day, end: end.toISOString().slice(0, 10) } });

  await signIn(page);
  await page.goto("/m/shop");
  const rice = page.locator(".shop-row").filter({ hasText: "Basmati rice" });
  const lentils = page.locator(".shop-row").filter({ hasText: "Red lentils" });
  await expect(rice).toBeVisible();
  await expect(lentils).toBeVisible();

  await startTrip(page, "Aldi");
  await rice.getByLabel("Unit", { exact: true }).selectOption("pack");
  await rice.getByLabel(/^Size of one pack/).fill("1000");
  await rice.getByLabel(/^Amount of/).fill("2");
  await rice.getByLabel(/^Price of/).fill("2,49");
  await rice.getByLabel(/^Price of/).blur();
  await expect(rice.locator(".shop-line-total")).toHaveText(/4,98\s€/);
  await rice.getByRole("checkbox").click();
  await expect(page.locator(".session-total")).toHaveText(/4,98\s€/);

  await page.getByPlaceholder("Add an item: panir, kiri, Milch, toilet paper").fill("eggs");
  await page.keyboard.press("Enter");
  const eggs = page.locator(".shop-row").filter({ hasText: "Eggs" });
  await expect(eggs.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  await eggs.getByLabel(/^Amount of/).fill("10");
  await eggs.getByRole("button", { name: /switch to total/ }).click();
  await eggs.getByLabel(/^Price of/).fill("3,29");
  await eggs.getByLabel(/^Price of/).blur();
  await expect(page.locator(".session-total")).toHaveText(/8,27\s€/);

  await context.setOffline(true);
  await rice.getByRole("checkbox").click();
  await expect(page.locator(".session-total")).toHaveText(/3,29\s€/);
  await rice.getByRole("checkbox").click();
  await expect(page.locator(".session-total")).toHaveText(/8,27\s€/);
  await page.getByRole("button", { name: "Finish at this store" }).click();
  await expect(page.getByText("It will reach the pantry when you are back online")).toBeVisible();
  await context.setOffline(false);
  await expect(page.locator(".offline-pill")).toBeHidden({ timeout: 30_000 });
  await expect.poll(() => stockOf(request, "Basmati rice")).toBe(riceBefore + 2000);
  expect(await stockOf(request, "Eggs")).toBe(eggsBefore + 10);

  await page.reload();
  await expect(lentils.getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
  await startTrip(page, "Persian shop");
  await lentils.getByLabel("Unit", { exact: true }).selectOption("g");
  await lentils.getByLabel(/^Amount of/).fill("500");
  await lentils.getByLabel(/^Price of/).fill("1,99");
  await lentils.getByLabel(/^Price of/).blur();
  await lentils.getByRole("checkbox").click();
  await expect(page.locator(".session-total")).toHaveText(/1,99\s€/);
  await page.getByRole("button", { name: "Finish at this store" }).click();
  await expect(page.getByText("Trip saved to the pantry")).toBeVisible();
  expect(await stockOf(request, "Red lentils")).toBe(lentilsBefore + 500);

  const list = (await (await request.get("/api/shopping")).json()) as { list: { id: number; sessions: { store: string; total: number }[] } };
  expect(list.list.sessions.map((entry) => [entry.store, entry.total])).toEqual([
    ["Aldi", 8.27],
    ["Persian shop", 1.99],
  ]);
  await request.post("/api/shopping/" + String(list.list.id) + "/close", { headers: H });

  const meals = (await (await request.get("/api/calendar?start=" + day + "&end=" + day)).json()) as { meals: { id: number; recipe_id: number }[] }[];
  const meal = meals[0].meals.find((entry) => entry.recipe_id === dish)!;
  expect((await request.post("/api/cook", { headers: H, data: { meal_id: meal.id } })).ok()).toBeTruthy();
  expect(await stockOf(request, "Basmati rice")).toBe(riceBefore + 2000 - 300);

  await request.post("/api/snacks", { headers: H, data: { name: "eggs", qty: 2, unit: "pcs" } });
  expect(await stockOf(request, "Eggs")).toBe(eggsBefore + 8);
  const snacks = (await (await request.get("/api/calendar?start=" + day + "&end=" + day)).json()) as { snacks: { id: number }[] }[];
  await request.delete("/api/snacks/" + String(snacks[0].snacks.at(-1)!.id), { headers: H });
  expect(await stockOf(request, "Eggs")).toBe(eggsBefore + 10);

  await page.goto("/m/pantry");
  await page.locator(".pantry-row", { hasText: "Basmati rice" }).click();
  await page.getByRole("button", { name: "Threw some away" }).click();
  const waste = page.getByRole("dialog", { name: "Threw away Basmati rice" });
  await waste.getByLabel("Amount").fill("1,5kg");
  await waste.getByRole("button", { name: "Record waste" }).click();
  await expect(page.getByText("The amount is not a number")).toBeVisible();
  expect(await stockOf(request, "Basmati rice")).toBe(riceBefore + 2000 - 300);
  await waste.getByLabel("Amount").fill("200");
  await waste.getByRole("button", { name: "Record waste" }).click();
  await expect(page.getByText("Pantry updated")).toBeVisible();
  expect(await stockOf(request, "Basmati rice")).toBe(riceBefore + 2000 - 500);
});

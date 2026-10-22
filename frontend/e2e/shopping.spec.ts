import { expect, test } from "@playwright/test";
import { createDish, signIn, today } from "./helpers";

test("build a list from the plan, shop with prices and fill the pantry", async ({ page, request }) => {
  const recipe = await createDish(request, "rice bowl", [["rice", 100, "g"]]);
  const day = await today(request);
  await request.post("/api/meals", { headers: { "X-User-Id": "1" }, data: { date: day, recipe_id: recipe, servings: 3 } });
  await signIn(page);
  await page.goto("/plan");
  await page.getByRole("button", { name: "Build shopping list" }).click();
  const build = page.getByRole("dialog", { name: "Build the shopping list" });
  await expect(build.getByText("Plan needs 300 g")).toBeVisible();
  await build.getByRole("button", { name: "Build list" }).click();
  await expect(page).toHaveURL(/\/shop$/);
  const row = page.locator(".shop-row", { hasText: "Basmati rice" });
  await expect(row).toContainText("need 300 g");

  await page.getByRole("button", { name: "Start shopping" }).click();
  const store = page.getByRole("dialog", { name: "Where are you shopping?" });
  await store.getByLabel("Store").fill("Market Hall");
  await store.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".session-bar")).toContainText("At Market Hall, 0 items");
  await row.getByLabel("Price of Basmati rice").fill("1,99");
  await row.getByLabel("Price of Basmati rice").blur();
  await row.getByRole("checkbox", { name: "Bought Basmati rice" }).click();
  await expect(page.locator(".session-bar")).toContainText("At Market Hall, 1 item");
  await expect(page.locator(".session-total")).toHaveText(/1,99\s€/);
  await page.getByRole("button", { name: "Finish at this store" }).click();
  await expect(page.getByText("Trip saved to the pantry")).toBeVisible();
  await expect(page.getByText("1 already in the pantry")).toBeVisible();

  const inventory = (await (await request.get("/api/inventory")).json()) as { items: { display: string; stock: number }[] };
  expect(inventory.items.find((item) => item.display === "Basmati rice")?.stock).toBe(300);
  await page.goto("/reports");
  await page.getByRole("tab", { name: "Prices" }).click();
  await expect(page.locator(".panel", { hasText: "Basmati rice" })).toContainText("6,63");
});

test("ticking items works offline and syncs later", async ({ page, context, request }) => {
  await request.post("/api/shopping/items", { headers: { "X-User-Id": "1" }, data: { name: "milk", qty: 1, unit: "l" } });
  await signIn(page);
  await page.goto("/shop");
  await expect(page.locator(".shop-row", { hasText: "Milk" })).toBeVisible();
  await page.getByRole("button", { name: "Start shopping" }).click();
  await page.getByRole("dialog", { name: "Where are you shopping?" }).getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".session-bar")).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("checkbox", { name: "Bought Milk" }).click();
  await expect(page.locator(".offline-pill")).toHaveText("Offline, 1 change waiting");
  await page.getByPlaceholder("Add an item: panir, kiri, Milch, toilet paper").fill("eggs");
  await page.keyboard.press("Enter");
  await expect(page.locator(".offline-pill")).toHaveText("Offline, 2 changes waiting");
  await context.setOffline(false);
  await expect(page.locator(".offline-pill")).toBeHidden({ timeout: 20_000 });
  const shopping = (await (await request.get("/api/shopping")).json()) as { list: { items: { checked: number; ingredient: { display: string } }[] } };
  const checked = shopping.list.items.filter((item) => item.checked).map((item) => item.ingredient.display);
  expect(checked).toEqual(expect.arrayContaining(["Milk", "Eggs"]));
});

test("price each counts every pack, packs fill the pantry by their size and unticking is instant", async ({ page, request }) => {
  const open = (await (await request.get("/api/shopping")).json()) as { list: { id: number } | null };
  if (open.list) await request.post("/api/shopping/" + String(open.list.id) + "/close", { headers: { "X-User-Id": "1" } });
  await signIn(page);
  await page.goto("/shop");
  await page.getByRole("button", { name: "Start shopping" }).click();
  const store = page.getByRole("dialog", { name: "Where are you shopping?" });
  await store.getByLabel("Store").fill("Rewe");
  await store.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".session-bar")).toBeVisible();

  const adder = page.getByPlaceholder("Add an item: panir, kiri, Milch, toilet paper");
  await adder.fill("lentils");
  await page.keyboard.press("Enter");
  const lentils = page.locator(".shop-row").filter({ hasText: /lentils/i });
  await expect(lentils.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  await lentils.getByLabel(/^Amount of/).fill("3");
  await lentils.getByLabel(/^Price of/).fill("1,29");
  await lentils.getByLabel(/^Price of/).blur();
  await expect(lentils.locator(".shop-line-total")).toHaveText(/3,87\s€/);
  await expect(page.locator(".session-total")).toHaveText(/3,87\s€/);

  await lentils.getByRole("checkbox").click();
  await expect(lentils.getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".session-total")).toHaveText(/0,00\s€/);
  await lentils.getByRole("checkbox").click();
  await expect(page.locator(".session-total")).toHaveText(/3,87\s€/);

  await adder.fill("rice");
  await page.keyboard.press("Enter");
  const rice = page.locator(".shop-row").filter({ hasText: /rice/i });
  await expect(rice.getByRole("checkbox")).toHaveAttribute("aria-checked", "true");
  await rice.getByLabel("Unit", { exact: true }).selectOption("pack");
  await rice.getByLabel(/^Size of one pack/).fill("1000");
  await rice.getByLabel(/^Price of/).fill("4,99");
  await rice.getByLabel(/^Price of/).blur();
  await expect(page.locator(".session-total")).toHaveText(/8,86\s€/);

  const before = (await (await request.get("/api/inventory")).json()) as { items: { display: string; stock: number }[] };
  const had = before.items.find((item) => item.display === "Basmati rice")?.stock ?? 0;
  await page.getByRole("button", { name: "Finish at this store" }).click();
  await expect(page.getByText("Trip saved to the pantry")).toBeVisible();
  const after = (await (await request.get("/api/inventory")).json()) as { items: { display: string; stock: number }[] };
  expect(after.items.find((item) => item.display === "Basmati rice")?.stock).toBe(had + 1000);
});

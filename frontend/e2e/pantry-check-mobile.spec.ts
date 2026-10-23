import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { addStock, createDish, signIn, today } from "./helpers";

const H = { "X-User-Id": "1" };

interface Item {
  id: number;
  display: string;
  stock: number;
  package_amount: number | null;
  pending_stock: { unit: string; qty: number }[];
}

async function tuna(request: APIRequestContext): Promise<Item> {
  const inventory = (await (await request.get("/api/inventory")).json()) as { items: Item[] };
  return inventory.items.find((item) => item.display === "Tuna")!;
}

async function listNote(request: APIRequestContext): Promise<{ unsure_stock: { qty: number; unit: string }[] } | undefined> {
  const shopping = (await (await request.get("/api/shopping")).json()) as {
    list: { items: { committed: number; checked: number; unsure_stock: { qty: number; unit: string }[]; ingredient: { display: string } }[] } | null;
  };
  return shopping.list?.items.find((item) => item.ingredient.display === "Tuna" && !item.committed && !item.checked);
}

async function openCheck(page: Page) {
  await page.goto("/m/pantry");
  await page.getByRole("button", { name: "Pantry check" }).click();
  const sheet = page.getByRole("dialog", { name: "Pantry check" });
  await expect(sheet).toBeVisible();
  return sheet;
}

test("count tuna in cans without knowing the grams and keep planning honest", async ({ page, request }) => {
  await addStock(request, "tuna", 300, "g");
  const dish = await createDish(request, "tuna pasta", [["tuna", 100, "g"]]);
  const day = await today(request);
  await request.post("/api/meals", { headers: H, data: { date: day, recipe_id: dish, servings: 2 } });
  const end = new Date(day + "T00:00:00");
  end.setDate(end.getDate() + 3);
  await request.post("/api/shopping/build", { headers: H, data: { start: day, end: end.toISOString().slice(0, 10) } });
  expect(await listNote(request)).toBeUndefined();

  await signIn(page);
  let sheet = await openCheck(page);
  await sheet.getByLabel("Unit for Tuna at home").selectOption("pack");
  await expect(sheet.getByRole("button", { name: "use about 150 g" })).toBeVisible();
  await expect(sheet.locator(".count-row", { hasText: "Tuna" }).getByText("Size unknown")).toBeVisible();
  await sheet.getByLabel("Tuna at home", { exact: true }).fill("4");
  await sheet.getByRole("button", { name: "Save check" }).click();
  await expect(page.getByText("Pantry check saved")).toBeVisible();

  let item = await tuna(request);
  expect(item.stock).toBe(0);
  expect(item.pending_stock).toEqual([{ unit: "pack", qty: 4 }]);
  expect((await listNote(request))?.unsure_stock).toEqual([{ qty: 4, unit: "pack" }]);
  await expect(page.locator(".pantry-row", { hasText: "Tuna" })).toContainText("4 pack of unknown size");

  sheet = await openCheck(page);
  await expect(sheet.getByLabel("Tuna at home", { exact: true })).toHaveValue("4");
  await expect(sheet.getByLabel("Unit for Tuna at home")).toHaveValue("pack");
  await sheet.getByRole("button", { name: "use about 150 g" }).click();
  await sheet.getByRole("button", { name: "Save check" }).click();
  await expect(page.getByText("Pantry check saved")).toBeVisible();

  item = await tuna(request);
  expect(item.stock).toBe(600);
  expect(item.package_amount).toBe(150);
  expect(item.pending_stock).toEqual([]);
  expect(await listNote(request)).toBeUndefined();

  sheet = await openCheck(page);
  await expect(sheet.getByLabel("Unit for Tuna at home")).toHaveValue("pack");
  await expect(sheet.getByLabel("Tuna at home", { exact: true })).toHaveValue("4");
  await sheet.getByLabel("Tuna at home", { exact: true }).fill("1");
  await sheet.getByRole("button", { name: "Save check" }).click();
  await expect(page.getByText("Pantry check saved")).toBeVisible();
  expect((await tuna(request)).stock).toBe(150);
  expect(await listNote(request)).toEqual(expect.objectContaining({ unsure_stock: [] }));

  sheet = await openCheck(page);
  await sheet.getByLabel("Tuna at home", { exact: true }).fill("1,5kg");
  await sheet.getByRole("button", { name: "Save check" }).click();
  await expect(page.getByText("one of them is not a number")).toBeVisible();
  expect((await tuna(request)).stock).toBe(150);
});

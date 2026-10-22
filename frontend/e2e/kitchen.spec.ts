import { expect, test } from "@playwright/test";
import { addStock, assistantDone, createDish, signIn, today } from "./helpers";

test.describe.configure({ mode: "serial" });

test("add a dish with new ingredients and let the assistant name them", async ({ page, request }) => {
  await signIn(page);
  await page.goto("/recipes");
  await page.getByRole("button", { name: "New dish" }).click();
  const sheet = page.getByRole("dialog", { name: "New dish" });
  await sheet.getByPlaceholder("Dish name, any language").fill("shakshuka");
  const adder = sheet.getByPlaceholder("Add an ingredient. Type in Persian, Finglish, German or English");
  await adder.fill("eggs");
  await adder.press("Enter");
  await sheet.getByLabel("Amount of eggs").fill("2");
  await sheet.getByLabel("Amount of eggs").locator("xpath=../..").getByLabel("Unit").selectOption("pcs");
  await adder.fill("tomatoes");
  await adder.press("Enter");
  await sheet.getByLabel("Amount of tomatoes").fill("150");
  await sheet.getByRole("button", { name: "Add dish" }).click();
  await expect(page.getByText("Dish added")).toBeVisible();
  await assistantDone(request);
  await page.reload();
  const card = page.locator("article.dish", { hasText: "Shakshuka" });
  await expect(card).toBeVisible();
  await expect(card.locator(".ing-pill")).toHaveText(["Eggs", "Tomatoes"]);
  await expect(card.getByText(/kcal each/)).toBeVisible();
});

test("stock the pantry from the pantry page", async ({ page, request }) => {
  await signIn(page);
  await page.goto("/pantry");
  const adder = page.getByPlaceholder("Add to the pantry: name in any language");
  await adder.fill("eggs");
  await expect(page.getByRole("option", { name: /Eggs/ })).toBeVisible();
  await adder.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Add Eggs" });
  await sheet.getByLabel("Amount").fill("6");
  await sheet.getByLabel("Unit").selectOption("pcs");
  await sheet.getByPlaceholder("optional").fill("2,49");
  await sheet.getByRole("button", { name: "Add to pantry" }).click();
  await expect(page.getByText("Pantry updated")).toBeVisible();
  await expect(page.locator(".pantry-row", { hasText: "Eggs" })).toContainText("6 pcs");
  await addStock(request, "tomatoes", 600, "g");
});

test("plan a meal, cook it and undo the cooking", async ({ page, request }) => {
  await signIn(page);
  await page.goto("/");
  await expect(page.getByText(/dish(es)? ready from your pantry/)).toBeVisible();
  await page.getByRole("button", { name: "Cook Shakshuka" }).click();
  const cook = page.getByRole("dialog", { name: "Cook Shakshuka" });
  await expect(cook.getByText("Taken from the pantry")).toBeVisible();
  await expect(cook.getByLabel("Amount of Eggs")).toHaveValue("4");
  await cook.getByRole("button", { name: "Cooked it" }).click();
  await expect(page.getByText("Cooked and pantry updated")).toBeVisible();
  await expect(page.locator(".stage-plate", { hasText: "Shakshuka" })).toContainText("cooked today");
  const eggs = (await (await request.get("/api/inventory")).json()) as { items: { display: string; stock: number }[] };
  expect(eggs.items.find((item) => item.display === "Eggs")?.stock).toBe(2);

  await page.locator(".stage-plate", { hasText: "Shakshuka" }).click();
  await page.getByRole("button", { name: "Undo cooking" }).click();
  await expect(page.getByText("Cooking undone, ingredients are back")).toBeVisible();

  const day = await today(request);
  await page.goto("/plan");
  await page.getByRole("button", { name: "Plan a meal on " + day }).click();
  const suggest = page.getByRole("dialog", { name: "Choose a dish" });
  await expect(suggest.getByText("Ready to cook")).toBeVisible();
  await suggest.locator(".list-row", { hasText: "Shakshuka" }).getByRole("button", { name: "Plan" }).click();
  await expect(page.getByText("Planned for today")).toBeVisible();
  await expect(page.locator(".day.is-today .meal")).toHaveCount(2);
});

test("log a snack", async ({ page, request }) => {
  await createDish(request, "lentil soup", [["lentils", 80, "g"]]);
  await signIn(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Log a snack" }).click();
  const sheet = page.getByRole("dialog", { name: "Log a snack" });
  await sheet.getByPlaceholder("Apple, yogurt, maast, Apfel").fill("tomatoes");
  await sheet.getByRole("option", { name: /Tomatoes/ }).click();
  await sheet.getByRole("button", { name: "Log snack" }).click();
  await expect(page.getByText("Snack logged")).toBeVisible();
  await expect(page.locator("section", { hasText: "Snacks today" })).toContainText("Tomatoes");
});

import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("create an API key for Home Gym and read the nutrition export with it", async ({ page, request }) => {
  await signIn(page);
  await page.goto("/settings");
  await page.getByLabel("Key name").fill("Home Gym");
  await page.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByText("Copy this key now, it is shown only once.")).toBeVisible();
  const key = (await page.locator(".new-token code").textContent()) ?? "";
  expect(key).toMatch(/^pk_/);
  await expect(page.locator(".list-row", { hasText: "Home Gym" })).toContainText("never used");
  const unauthorized = await request.get("/api/export/nutrition");
  expect(unauthorized.status()).toBe(401);
  const export_ = await request.get("/api/export/nutrition", { headers: { Authorization: "Bearer " + key } });
  expect(export_.ok()).toBeTruthy();
  const body = (await export_.json()) as { days: { date: string; totals: Record<string, number>; user: { name: string } }[] };
  expect(body.days.length).toBeGreaterThan(0);
  expect(Object.keys(body.days[0]?.totals ?? {}).sort()).toEqual(["carbs", "fat", "fiber", "kcal", "protein"]);

  await page.getByLabel("Webhook address").fill("http://homegym.local:8090/api/integrations/pantry");
  await page.getByRole("button", { name: "Add webhook" }).click();
  await expect(page.getByRole("dialog", { name: "Webhook added" }).locator("code")).toHaveText(/^whsec_/);
});

test("rename a person and change the default number of people", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings");
  await page.getByLabel("People per meal").fill("3");
  await page.locator("section", { hasText: "Planning" }).getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".toast", { hasText: "Saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("People per meal")).toHaveValue("3");
});

import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

test("phone layout navigates with the tab bar and the more sheet", async ({ page }) => {
  await signIn(page);
  await page.goto("/m");
  await expect(page.locator(".tabbar")).toBeVisible();
  await page.locator(".tabbar").getByRole("link", { name: "Plan" }).click();
  await expect(page).toHaveURL(/\/m\/plan$/);
  await expect(page.getByText("Hold a dish to move it to another day or change its order.")).toBeVisible();
  await page.locator(".tabbar").getByRole("button", { name: "More" }).click();
  await page.getByRole("dialog", { name: "More" }).getByRole("link", { name: "Dishes" }).click();
  await expect(page).toHaveURL(/\/m\/recipes$/);
  await expect(page.getByRole("heading", { name: "Dishes" })).toBeVisible();
});

test("old phone links and push notification links still work", async ({ page }) => {
  await signIn(page);
  await page.goto("/m/#shop");
  await expect(page).toHaveURL(/\/m\/shop$/);
  await expect(page.getByRole("heading", { name: "Shopping" })).toBeVisible();
  await page.goto("/m/alerts");
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();
});

test("phones opening the desktop address get the phone layout", async ({ page }) => {
  await signIn(page);
  await page.goto("/plan");
  await expect(page).toHaveURL(/\/m\/plan$/);
});

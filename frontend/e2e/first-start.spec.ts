import { expect, test } from "@playwright/test";

test("first start asks who is using the device and shows an empty pantry", async ({ page }) => {
  await page.goto("/");
  const chooser = page.getByRole("dialog", { name: "Choose who is using this device" });
  await expect(chooser).toBeVisible();
  await chooser.getByRole("button", { name: "User" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Good (morning|afternoon|evening), User/);
  await expect(page.getByText("The pantry is empty")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open shopping" })).toBeVisible();
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByText("This device: User")).toBeVisible();
});

test("old hash links open the right page", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("pantry:user", "1"));
  await page.goto("/#recipes");
  await expect(page).toHaveURL(/\/recipes$/);
  await expect(page.getByRole("heading", { name: "Dishes" })).toBeVisible();
  await page.goto("/nowhere");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

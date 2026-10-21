import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, devices } from "@playwright/test";

const base = process.env.PANTRY_URL ?? "http://127.0.0.1:8000";
const out = process.argv[2] ?? "screenshots";
const only = process.argv[3] ?? "";
mkdirSync(out, { recursive: true });

const DESKTOP = [
  ["today", "/"],
  ["plan", "/plan"],
  ["dishes", "/recipes"],
  ["pantry", "/pantry"],
  ["shopping", "/shop"],
  ["reports", "/reports"],
  ["notes", "/alerts"],
  ["settings", "/settings"],
];
const MOBILE = [
  ["m-today", "/m"],
  ["m-plan", "/m/plan"],
  ["m-shop", "/m/shop"],
  ["m-pantry", "/m/pantry"],
  ["m-dishes", "/m/recipes"],
  ["m-reports", "/m/reports"],
  ["m-notes", "/m/alerts"],
  ["m-settings", "/m/settings"],
];

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForSelector(".skeleton", { state: "detached" }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
}

async function shoot(context, list, fullPage) {
  const page = await context.newPage();
  for (const [name, path] of list) {
    if (only && !name.includes(only)) continue;
    await page.goto(base + path);
    await settle(page);
    await page.screenshot({ path: join(out, name + ".png"), fullPage });
  }
  return page;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const init = () => {
  window.localStorage.setItem("pantry:user", "1");
};

const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "dark" });
await desktop.addInitScript(init);
const page = await shoot(desktop, DESKTOP, false);
if (!only || only === "sheets") {
  await page.goto(base + "/recipes");
  await settle(page);
  await page.getByRole("button", { name: "Edit" }).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, "dish-editor.png") });
  await page.keyboard.press("Escape");
  await page.goto(base + "/");
  await settle(page);
  await page.getByRole("button", { name: "What can I cook?" }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(out, "suggestions.png") });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.locator(".reel-card.is-current").click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(out, "cook.png") });
}
await desktop.close();

const phone = await browser.newContext({ ...devices["Pixel 7"], reducedMotion: "reduce", colorScheme: "dark" });
await phone.addInitScript(init);
await shoot(phone, MOBILE, false);
await phone.close();
await browser.close();

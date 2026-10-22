import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const UI_ICONS = ["package", "shallow-pan-of-food", "fork-and-knife-with-plate", "cooking", "basket", "shopping-cart", "green-salad", "tear-off-calendar", "teacup-without-handle"];
const names = new Set([...JSON.parse(readFileSync(join(root, "..", "app", "icon_names.json"), "utf8")), ...UI_ICONS]);
const set = JSON.parse(readFileSync(join(root, "node_modules", "@iconify-json", "fluent-emoji-flat", "icons.json"), "utf8"));
const out = join(root, "public", "icons");
mkdirSync(out, { recursive: true });
for (const name of names) {
  const icon = set.icons[name];
  if (!icon) throw new Error("Unknown icon " + name);
  const width = icon.width ?? set.width ?? 32;
  const height = icon.height ?? set.height ?? 32;
  writeFileSync(join(out, name + ".svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + String(width) + " " + String(height) + '">' + icon.body + "</svg>");
}
writeFileSync(join(out, "ATTRIBUTION.txt"), "Food icons: Fluent Emoji Flat by Microsoft, MIT License, via Iconify.\n");
console.warn("Wrote " + String(names.size) + " icons");

import { describe, expect, it } from "vitest";
import { isMobilePath, legacyTarget, phonePath, routePath, shouldUsePhone } from "../routes";

describe("routes", () => {
  it("maps old hash links to real paths", () => {
    expect(legacyTarget("/", "#plan")).toBe("/plan");
    expect(legacyTarget("/", "#today")).toBe("/");
    expect(legacyTarget("/m/", "#shop")).toBe("/m/shop");
    expect(legacyTarget("/m/", "#alerts")).toBe("/m/alerts");
    expect(legacyTarget("/m/", "")).toBe("/m");
    expect(legacyTarget("/m/", "#today")).toBe("/m");
    expect(legacyTarget("/", "#nothing")).toBe("/");
    expect(legacyTarget("/plan", "")).toBeNull();
  });

  it("knows desktop and phone paths", () => {
    expect(isMobilePath("/m")).toBe(true);
    expect(isMobilePath("/m/plan")).toBe(true);
    expect(isMobilePath("/media")).toBe(false);
    expect(routePath("today", false)).toBe("/");
    expect(routePath("shop", true)).toBe("/m/shop");
  });

  it("sends phones to the phone layout unless asked not to", () => {
    expect(shouldUsePhone("/", true, "Mozilla iPhone", false)).toBe(true);
    expect(shouldUsePhone("/", true, "Mozilla iPhone", true)).toBe(false);
    expect(shouldUsePhone("/", false, "Mozilla Android", false)).toBe(false);
    expect(shouldUsePhone("/", true, "Mozilla Windows", false)).toBe(false);
    expect(shouldUsePhone("/m", true, "iPhone", false)).toBe(false);
    expect(phonePath("/")).toBe("/m");
    expect(phonePath("/plan")).toBe("/m/plan");
  });
});

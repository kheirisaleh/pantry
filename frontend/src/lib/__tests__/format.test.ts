import { describe, expect, it } from "vitest";
import { addDays, dayLabel, displayName, durationLabel, fromIso, greeting, iso, money, monday, parseNumber, plural, qty, shortDate, trim } from "../format";

describe("format", () => {
  it("formats quantities like the old app", () => {
    expect(qty(250, "g")).toBe("250 g");
    expect(qty(1500, "g")).toBe("1.5 kg");
    expect(qty(2000, "ml")).toBe("2 l");
    expect(qty(2.5, "pcs")).toBe("2.5 pcs");
    expect(qty(12.4, "pcs")).toBe("12 pcs");
    expect(qty(1, "tbsp")).toBe("1 tbsp");
    expect(qty(3.25, "g")).toBe("3.3 g");
    expect(qty(null, "g")).toBe("");
  });

  it("formats money in euro with a German locale", () => {
    expect(money(3.5)).toMatch(/^3,50\s€$/);
    expect(money("")).toBe("");
    expect(money(null)).toBe("");
  });

  it("parses numbers typed with comma or spaces", () => {
    expect(parseNumber("1,5")).toBe(1.5);
    expect(parseNumber(" 2 000 ")).toBe(2000);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber(4)).toBe(4);
    expect(parseNumber(undefined)).toBeNull();
  });

  it("works with plain dates", () => {
    expect(iso(fromIso("2026-03-04"))).toBe("2026-03-04");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(monday("2026-10-21")).toBe("2026-10-19");
    expect(monday("2026-10-19")).toBe("2026-10-19");
    expect(dayLabel("2026-10-21", "2026-10-21")).toBe("Today");
    expect(dayLabel("2026-10-22", "2026-10-21")).toBe("Tomorrow");
    expect(dayLabel("2026-10-20", "2026-10-21")).toBe("Yesterday");
    expect(dayLabel("2026-10-25", "2026-10-21")).toBe("Sun 25 Oct");
    expect(shortDate("2026-10-25 10:00:00")).toBe("25 Oct");
  });

  it("has small text helpers", () => {
    expect(trim(2.0, 1)).toBe("2");
    expect(displayName({ name_en: null, raw_name: "berenj" })).toBe("berenj");
    expect(displayName({})).toBe("?");
    expect(plural(1, "dish", "dishes")).toBe("1 dish");
    expect(plural(3, "item")).toBe("3 items");
    expect(greeting(9)).toBe("Good morning");
    expect(greeting(13)).toBe("Good afternoon");
    expect(greeting(20)).toBe("Good evening");
    expect(durationLabel(90)).toBe("2 min");
    expect(durationLabel(3700)).toBe("1 h 2 min");
  });
});

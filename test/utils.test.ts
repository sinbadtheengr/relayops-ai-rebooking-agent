import { describe, expect, it } from "vitest";
import { todayIso } from "../src/utils.js";

describe("todayIso (G-13)", () => {
  it("returns the current date in the business timezone, not UTC", () => {
    // Tests run with the default TIMEZONE (America/Toronto). A UTC-sliced
    // implementation fails this every evening after ~19:00 Toronto time.
    const expected = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
    expect(todayIso()).toBe(expected);
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

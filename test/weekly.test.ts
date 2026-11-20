import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { config } from "../src/config.js";
import { closeDb } from "../src/db.js";
import {
  auditTrail,
  approveDraft,
  createOutreachDraft,
  getOpportunities,
  recordOptOut,
  recordReply
} from "../src/relayops.js";
import { midnight } from "../src/utils.js";
import { previousMonday, weeklyReport, weeklyText } from "../src/weekly.js";
import { load, sent } from "./fixtures.js";

const time = (s: string) => vi.setSystemTime(new Date(s));
let n = 0;
beforeEach(() => {
  config.clientId = "week-" + ++n;
  vi.useFakeTimers();
  time("2026-10-25T14:00:00Z");
});
afterEach(() => {
  closeDb();
  vi.useRealTimers();
});

it("counts the seven measures in local calendar weeks, with corrections, late CSVs and no duplicate attribution", () => {
  const second = { customer_id: "c2", appointment_id: "a2", email: "second@example.test" };
  const third = { customer_id: "c3", appointment_id: "a3", email: "third@example.test" };
  load([{}, second, third]);
  const monday = "2026-10-26";
  time("2026-10-26T03:59:59.999Z");
  const outside = sent("c2");
  time("2026-10-26T04:00:00Z");
  const within = sent("c1");
  const d = createOutreachDraft("c3");
  approveDraft(d.id);
  time("2026-10-26T15:00:00Z");
  recordReply(within.id, "R1", "2026-10-26T14:00:00Z", "reply");
  recordReply(outside.id, "R2", "2026-10-26T14:00:00Z", "optout");
  expect(() => recordReply(d.id, "R3", "2026-10-26T14:00:00Z", "reply")).toThrow("confirmed send");
  const recovered = {
    appointment_id: "new",
    status: "completed",
    booked_at: "2026-10-26T14:00:01Z",
    service_date: "2026-10-27",
    revenue_cents: "4567"
  };
  const scheduled = {
    ...recovered,
    appointment_id: "next",
    status: "scheduled",
    service_date: "2026-11-20",
    revenue_cents: "9999"
  };
  const preexisting = { ...recovered, appointment_id: "before", booked_at: "2026-10-26T03:59:59Z" };
  const sameInstant = { ...recovered, appointment_id: "tie", booked_at: "2026-10-26T04:00:00Z" };
  const missingDate = { ...recovered, appointment_id: "missing", booked_at: "" };
  time("2026-11-01T16:00:00Z");
  load([recovered, scheduled, preexisting, sameInstant, missingDate], "2026-11-01T12:00:00Z");
  time("2026-11-02T05:00:00Z");
  recordOptOut("c3", "phone request");
  recordReply(within.id, "next-week", "2026-11-02T05:00:00Z", "reply");
  expect(getOpportunities()).toHaveLength(0);
  const expected = {
    overdueClients: 2,
    contactableClients: 1,
    draftsApproved: 2,
    messagesSent: 1,
    replies: 2,
    bookings: 2,
    recoveredRevenueCents: 4567
  };
  expect(weeklyReport()).toMatchObject(expected);
  expect(weeklyText(weeklyReport(monday))).toContain("$45.67");
  expect(weeklyReport("2026-11-02")).toMatchObject({
    contactableClients: 0,
    messagesSent: 0,
    replies: 1,
    bookings: 0,
    recoveredRevenueCents: 0
  });
  time("2026-11-03T15:00:00Z");
  load(
    [
      { ...scheduled, status: "cancelled" },
      { ...recovered, revenue_cents: "1245" }
    ],
    "2026-11-03T13:00:00Z"
  );
  expect(weeklyReport(monday)).toMatchObject({ ...expected, bookings: 1, recoveredRevenueCents: 1245 });
  expect(auditTrail()).toEqual(
    expect.arrayContaining([expect.objectContaining({ action: "report.generated", target: monday })])
  );
});

it("credits a booking once across multiple sends and excludes a booking beyond 30 days", () => {
  load();
  sent("c1");
  time("2026-11-10T15:00:00Z");
  sent("c1");
  time("2026-12-20T15:00:00Z");
  load(
    [
      { appointment_id: "b", booked_at: "2026-11-11T12:00:00Z", service_date: "2026-11-12", revenue_cents: "123" },
      { appointment_id: "late", booked_at: "2026-12-15T12:00:00Z", service_date: "2026-12-16" }
    ],
    "2026-12-19T00:00:00Z"
  );
  expect(weeklyReport("2026-11-09")).toMatchObject({ bookings: 1, recoveredRevenueCents: 123 });
  expect(weeklyReport("2026-12-14")).toMatchObject({ bookings: 0, recoveredRevenueCents: 0 });
});

it("uses local Monday midnight and handles DST, empty periods and invalid dates", () => {
  expect(midnight("2026-10-26")).toBe("2026-10-26T04:00:00.000Z");
  expect(midnight("2026-11-02")).toBe("2026-11-02T05:00:00.000Z");
  expect(midnight("2026-03-09")).toBe("2026-03-09T04:00:00.000Z");
  expect(previousMonday("2026-01-01")).toBe("2025-12-22");
  expect(weeklyReport("2026-10-19")).toMatchObject({
    overdueClients: 0,
    contactableClients: 0,
    draftsApproved: 0,
    messagesSent: 0,
    replies: 0,
    bookings: 0,
    recoveredRevenueCents: 0
  });
  for (const bad of ["2026-11-31", "2026-10-27", "2030-01-07", "bad"])
    expect(() => weeklyReport(bad)).toThrow("Monday");
});

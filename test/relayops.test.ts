import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { asActor } from "../src/actor.js";
import { config } from "../src/config.js";
import { closeDb, getDb } from "../src/db.js";
import {
  approveDraft,
  auditTrail,
  cancelDelivery,
  confirmSent,
  createOutreachDraft,
  getDailySummary,
  getOpportunities,
  importBookings,
  listRecentlyContacted,
  messageRecord,
  recordOptOut,
  recordReply,
  releaseMessage
} from "../src/relayops.js";
import { csv, four, load, oldVisit, sent } from "./fixtures.js";

const clock = (s: string) => vi.setSystemTime(new Date(s));
const staff = <T>(id: string, fn: () => T) => asActor("slack:" + id, fn);
let n = 0;
beforeEach(() => {
  config.clientId = "spa-" + ++n;
  vi.useFakeTimers();
  clock("2026-11-10T15:00:00Z");
});
afterEach(() => {
  closeDb();
  vi.useRealTimers();
});

describe("CSV and client storage", () => {
  it("opens empty, imports quoted UTF-8 CSV atomically, survives restarts and isolates overlapping IDs", () => {
    expect(getDailySummary().overdueCustomerCount).toBe(0);
    const file = "\uFEFF" + csv([{ full_name: 'Zoë, "Z" Example', consent_evidence: "Form\nE101" }]);
    const at = "2026-11-01T17:00:00Z";
    const client = config.clientId;
    expect(importBookings(client, file, at)).toMatchObject({ profiles: 1, bookings: 1, duplicate: false });
    expect(importBookings(client, file, at)).toMatchObject({ profiles: 0, bookings: 0, duplicate: true });
    const m = sent("c1");
    closeDb();
    expect(existsSync(join(config.dataDir, `client-${client}.sqlite`))).toBe(true);
    config.clientId = "other";
    expect(getDailySummary().overdueCustomerCount).toBe(0);
    expect(() => messageRecord(m.id)).toThrow("Unknown message");
    expect(() => importBookings(client, file, at)).toThrow("does not match");
    load([{ full_name: "Other person" }]);
    expect(getOpportunities()[0].fullName).toBe("Other person");
    expect(JSON.stringify(auditTrail())).not.toContain("Zoë");
    closeDb();
    config.clientId = client;
    expect(getOpportunities({ includeContacted: true })[0].fullName).toBe('Zoë, "Z" Example');
    expect(messageRecord(m.id).events).toHaveLength(3);
  });

  it("rejects misplaced database files and unsafe client IDs", () => {
    load();
    closeDb();
    const file = join(config.dataDir, "client-" + config.clientId + ".sqlite");
    copyFileSync(file, join(config.dataDir, "client-wrong.sqlite"));
    config.clientId = "wrong";
    expect(getDb).toThrow("mismatch");
    config.clientId = "../wrong";
    expect(getDb).toThrow("slug");
  });

  it.each([
    ["invalid calendar date", { service_date: "2026-02-31" }],
    ["negative money", { revenue_cents: "-1" }],
    ["fractional cents", { revenue_cents: "0.12" }],
    ["zero cycle", { typical_return_days: "0" }],
    ["missing consent evidence", { consent_evidence: "" }],
    ["future consent", { consent_at: "2030-01-01T00:00:00Z" }],
    ["future completed visit", { service_date: "2030-01-01" }],
    ["unknown status", { status: "active" }]
  ])("rejects the whole file on %s", (_label, bad) => {
    expect(() => load([{}, { ...(bad as object), customer_id: "c2", appointment_id: "a2" }])).toThrow();
    expect(getDailySummary().overdueCustomerCount).toBe(0);
    expect(auditTrail()).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "csv.import", outcome: "failed" })])
    );
  });

  it("checks headers, duplicate IDs, client markers and export ordering", () => {
    const at = "2026-11-01T00:00:00Z";
    const imp = (file: string) => importBookings(config.clientId, file, at);
    expect(() => imp("id,id\na,b")).toThrow("Duplicate");
    expect(() => imp("a,b")).toThrow("no data");
    expect(() => imp("a,b\nx,y")).toThrow("Invalid");
    expect(() => imp(csv([{}, { full_name: "Different" }]))).toThrow("Conflicting");
    expect(() => imp(csv([{}, { revenue_cents: "222" }]))).toThrow("Conflicting");
    expect(() => imp(csv([{}]).replace("\r\n", ",client_id\r\n") + ",foreign")).toThrow("Client ID");
    load([{}, {}], at);
    expect(() => load([{ customer_id: "other" }], "2026-11-02T00:00:00Z")).toThrow("another customer");
    expect(() => load([{ email: "changed@example.test" }], at)).toThrow("newer");
    expect(() => load([{}], "2025-01-01T00:00:00Z")).toThrow("newer");
    expect(() => load([{}], "2030-01-01T00:00:00Z")).toThrow("future");
    expect(getOpportunities()).toHaveLength(1);
    expect(getOpportunities()[0].appointmentCount).toBe(1);
  });

  it("upserts corrected bookings, excludes future reservations and keeps omitted clients", () => {
    four();
    load([{ appointment_id: "future", status: "scheduled", service_date: "2026-12-01" }], "2026-11-02T00:00:00Z");
    expect(getDailySummary().overdueCustomerCount).toBe(3);
    load([{ appointment_id: "future", status: "cancelled", service_date: "2026-12-01" }], "2026-11-03T00:00:00Z");
    expect(getDailySummary().overdueCustomerCount).toBe(4);
    load([{ status: "no_show" }], "2026-11-04T00:00:00Z");
    expect(getDailySummary().overdueCustomerCount).toBe(3);
  });
});

describe("evidence and staff approval", () => {
  it("creates an SMS with the spa identity and records a month-end implied purchase expiry", () => {
    clock("2024-03-01T15:00:00Z");
    load(
      [
        {
          preferred_channel: "sms",
          phone: "(416) 555-0100",
          consent_at: "2024-02-29T16:00:00Z",
          consent_basis: "implied_purchase",
          consent_evidence: "Paid receipt P18"
        }
      ],
      "2024-03-01T12:00:00Z"
    );
    clock("2026-02-27T16:00:00Z");
    const draft = createOutreachDraft("c1");
    expect(draft.message).toContain("Example Spa");
    expect(draft.message).toContain("Reply STOP");
    const { message } = messageRecord(draft.id);
    expect(message).toMatchObject({
      channel: "sms",
      destination: "+14165550100",
      evidence: { basis: "implied_purchase", expiresOn: "2026-02-28", evidence: "Paid receipt P18" }
    });
    approveDraft(draft.id);
    clock("2026-02-28T05:00:00Z");
    expect(() => releaseMessage(draft.id)).toThrow("eligible");
  });

  it.each([
    ["unknown basis", { consent_basis: "none", consent_at: "", consent_evidence: "" }],
    ["no email", { email: "" }],
    ["invalid phone", { preferred_channel: "sms", phone: "555" }],
    ["phone calls", { preferred_channel: "phone", phone: "+14165550100" }],
    ["expired purchase", { consent_basis: "implied_purchase" }],
    ["expired inquiry", { consent_basis: "implied_inquiry" }]
  ])("keeps %s in the overdue count but rejects outreach", (_label, fields) => {
    load([fields as object]);
    expect(getDailySummary().overdueCustomerCount).toBe(1);
    expect(getOpportunities({ includeContacted: true })).toHaveLength(0);
    expect(() => createOutreachDraft("c1")).toThrow("eligible");
  });

  it("expires implied consent on the anniversary in the business timezone, even after approval", () => {
    clock("2026-11-10T04:59:59Z");
    load([{ consent_basis: "implied_inquiry", consent_at: "2026-05-10T16:00:00Z" }], "2026-06-01T00:00:00Z");
    const d = createOutreachDraft("c1");
    approveDraft(d.id);
    clock("2026-11-10T05:00:00Z");
    expect(() => releaseMessage(d.id)).toThrow("eligible");
  });

  it("captures exact text, identity, evidence, actors and timestamps, and confirms one actual manual send", () => {
    four();
    const d = staff("frontdesk", () => createOutreachDraft("c1"));
    expect(d.message).toContain("Reply STOP");
    expect(d.message).toContain(config.mailingAddress);
    expect(d.message).toContain(config.contactEmail);
    expect(() => confirmSent(d.id)).toThrow("handoff");
    expect(() => releaseMessage(d.id)).toThrow("approval");
    expect(() => asActor("agent:mcp", () => approveDraft(d.id))).toThrow("staff member");
    staff("reviewer", () => approveDraft(d.id));
    staff("reviewer", () => approveDraft(d.id));
    const copy = staff("sender", () => releaseMessage(d.id));
    expect(copy).toEqual({
      destination: "user1@example.test",
      channel: "email",
      body: d.message,
      alreadyClaimed: false
    });
    expect(staff("sender", () => releaseMessage(d.id)).alreadyClaimed).toBe(true);
    expect(() => staff("another", () => releaseMessage(d.id))).toThrow("Another staff");
    expect(() => staff("another", () => confirmSent(d.id))).toThrow("own");
    closeDb();
    staff("sender", () => {
      confirmSent(d.id);
      confirmSent(d.id);
    });
    const record = messageRecord(d.id);
    expect(record.message).toMatchObject({
      creator: "slack:frontdesk",
      body: d.message,
      template: "med-spa-rebooking-v1",
      hash: expect.stringMatching(/^[0-9a-f]{64}$/)
    });
    expect(record.message.sender.senderName).toBe("Example Spa");
    expect(record.events.map((e: any) => [e.kind, e.actor])).toEqual([
      ["approved", "slack:reviewer"],
      ["released", "slack:sender"],
      ["sent", "slack:sender"]
    ]);
    for (const e of record.events as any[]) {
      expect(Date.parse(e.at)).toBe(Date.now());
      expect(e.evidence).toMatchObject({
        basis: "express",
        grantedAt: oldVisit.consent_at.replace("Z", ".000Z"),
        evidence: oldVisit.consent_evidence,
        optedOut: false,
        destination: copy.destination
      });
    }
    expect(listRecentlyContacted().map((c) => c.id)).toEqual(["c1"]);
    expect(getOpportunities({ limit: 1 })).toHaveLength(1);
    expect(getOpportunities({ vipOnly: true, priority: "Low" })).toHaveLength(0);
    expect(getDailySummary().recentlyContactedCount).toBe(1);
    expect(getOpportunities({ includeContacted: true })).toHaveLength(4);
    clock("2026-11-25T15:00:00Z");
    expect(getOpportunities()).toHaveLength(4);
    expect(() => releaseMessage(d.id)).toThrow("already been sent");
    expect(() => getDb().prepare("UPDATE messages SET body='changed'").run()).toThrow("append-only");
    expect(() => getDb().prepare("DELETE FROM audit").run()).toThrow("append-only");
  });

  it("blocks an alternative draft during handoff, allows cancellation and rejects stale addresses", () => {
    load();
    const a = createOutreachDraft("c1"),
      b = createOutreachDraft("c1");
    approveDraft(a.id);
    approveDraft(b.id);
    releaseMessage(a.id);
    expect(() => releaseMessage(b.id)).toThrow("eligible");
    cancelDelivery(a.id);
    expect(() => confirmSent(a.id)).toThrow();
    expect(releaseMessage(b.id).destination).toBe(oldVisit.email);
    load([{ email: "new@example.test" }], "2026-11-10T15:00:00Z");
    expect(() => confirmSent(b.id)).toThrow("changed");
    cancelDelivery(b.id);
    expect(() => approveDraft(a.id)).toThrow("stale");
  });

  it("preserves CSV and staff opt-outs across reimports and shared normalized numbers", () => {
    const p = { preferred_channel: "sms", phone: "(416) 555-0100" };
    load([p, { ...p, customer_id: "c2", appointment_id: "a2", phone: "+1 416 555 0100" }]);
    const d = createOutreachDraft("c2");
    approveDraft(d.id);
    load([{ ...p, opted_out_at: "2026-11-01T12:00:00Z" }], "2026-11-02T12:00:00Z");
    expect(() => releaseMessage(d.id)).toThrow("eligible");
    load([p], "2026-11-03T12:00:00Z");
    expect(getOpportunities({ includeContacted: true })).toHaveLength(0);
    recordOptOut("c2", "front desk request");
    expect(messageRecord(d.id).withdrawals).toHaveLength(2);
  });

  it("checks opt-out on confirmation and permits accurate late entry for a send made before withdrawal", () => {
    load();
    const d = createOutreachDraft("c1");
    approveDraft(d.id);
    releaseMessage(d.id);
    clock("2026-11-10T15:05:00Z");
    recordOptOut("c1", "reception");
    expect(() => confirmSent(d.id)).toThrow("changed");
    confirmSent(d.id, "2026-11-10T15:01:00Z");
    recordReply(d.id, "inbox-1", "2026-11-10T15:02:00Z", "optout");
    recordReply(d.id, "inbox-1", "2026-11-10T15:02:00Z", "optout");
    expect(() => recordReply(d.id, "inbox-1", "2026-11-10T15:02:00Z", "reply")).toThrow("different");
    expect(messageRecord(d.id).replies).toHaveLength(1);
    expect(messageRecord(d.id).withdrawals).toHaveLength(2);
  });
});

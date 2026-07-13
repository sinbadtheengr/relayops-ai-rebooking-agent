import { beforeAll, describe, expect, it } from "vitest";
import { seedDemoData } from "../src/demoData.js";
import { getDb } from "../src/db.js";
import {
  CONTACT_COOLDOWN_DAYS,
  createOutreachDraft,
  getDailySummary,
  getOpportunities,
  listRecentlyContacted,
  markCustomerContacted
} from "../src/relayops.js";

beforeAll(() => {
  seedDemoData();
});

describe("getOpportunities filters", () => {
  it("returns only overdue customers", () => {
    const all = getOpportunities({ limit: 100 });
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((c) => c.daysOverdue > 0)).toBe(true);
  });

  it("honors the priority filter", () => {
    const high = getOpportunities({ priority: "High", limit: 100 });
    expect(high.every((c) => c.priority === "High")).toBe(true);
  });

  it("honors the vipOnly filter", () => {
    const vip = getOpportunities({ vipOnly: true, limit: 100 });
    expect(vip.every((c) => c.vip)).toBe(true);
  });

  it("respects the limit", () => {
    expect(getOpportunities({ limit: 3 }).length).toBe(3);
  });
});

describe("createOutreachDraft", () => {
  it("throws on an unknown customer id", () => {
    expect(() => createOutreachDraft("cus_does_not_exist")).toThrow();
  });

  it("returns a personalized message for a real customer", () => {
    const top = getOpportunities({ limit: 1 })[0];
    const draft = createOutreachDraft(top.id);
    expect(draft.customer.id).toBe(top.id);
    expect(draft.message.length).toBeGreaterThan(0);
  });
});

describe("G-01 contact suppression", () => {
  it("drops a customer from scans after they are marked contacted, but keeps them under includeContacted", () => {
    const topId = getOpportunities({ limit: 1 })[0].id;
    markCustomerContacted(topId, "test contact");

    expect(getOpportunities({ limit: 100 }).some((c) => c.id === topId)).toBe(false);
    expect(getOpportunities({ includeContacted: true, limit: 100 }).some((c) => c.id === topId)).toBe(true);
  });

  it("counts suppressed customers in the daily summary", () => {
    const before = getDailySummary().recentlyContactedCount;
    const nextId = getOpportunities({ limit: 1 })[0].id;
    markCustomerContacted(nextId, "test contact");
    expect(getDailySummary().recentlyContactedCount).toBe(before + 1);
  });

  it("surfaces suppressed customers via listRecentlyContacted", () => {
    const target = getOpportunities({ limit: 1 })[0];
    markCustomerContacted(target.id, "test contact");
    expect(listRecentlyContacted().some((c) => c.id === target.id)).toBe(true);
  });

  it("does NOT suppress a contact older than the cooldown window", () => {
    const target = getOpportunities({ limit: 1 })[0];
    const expiredIso = new Date(Date.now() - (CONTACT_COOLDOWN_DAYS + 1) * 86_400_000).toISOString();
    getDb()
      .prepare(
        `INSERT INTO outreach_logs (id, customer_id, channel, message, status, created_at) VALUES (?, ?, 'sms', 'old', 'contacted', ?)`
      )
      .run(`out_expired_${target.id}`, target.id, expiredIso);

    // The expired log must not remove the customer from the default scan.
    expect(getOpportunities({ limit: 100 }).some((c) => c.id === target.id)).toBe(true);
  });
});

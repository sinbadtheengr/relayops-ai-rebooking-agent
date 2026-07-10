import { describe, expect, it } from "vitest";
import { rankOpportunities, scoreCustomer } from "../src/scoring.js";
import { todayIso } from "../src/utils.js";
import type { CustomerRecord } from "../src/types.js";

/** Build a CustomerRecord whose last visit is `daysAgo` before today. */
function record(overrides: Partial<CustomerRecord> = {}, daysAgo = 200): CustomerRecord {
  const lastVisit = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  return {
    id: "cus_test",
    fullName: "Test Customer",
    email: "test@example.com",
    phone: "555-0100",
    businessType: "Salon",
    preferredChannel: "sms",
    vip: false,
    typicalReturnDays: 30,
    totalSpendCents: 50_000,
    averageTicketCents: 8_000,
    marketingConsent: true,
    notes: "",
    createdAt: todayIso(),
    lastVisitDate: lastVisit,
    lastServiceType: "Haircut",
    appointmentCount: 3,
    ...overrides
  };
}

describe("scoreCustomer", () => {
  it("adds +8 for VIP", () => {
    const base = scoreCustomer(record({ vip: false }));
    const vip = scoreCustomer(record({ vip: true }));
    expect(vip.priorityScore - base.priorityScore).toBe(8);
  });

  it("penalizes missing marketing consent and routes to phone", () => {
    const withConsent = scoreCustomer(record({ marketingConsent: true, preferredChannel: "sms" }));
    const noConsent = scoreCustomer(record({ marketingConsent: false, preferredChannel: "sms" }));
    expect(withConsent.priorityScore - noConsent.priorityScore).toBe(12);
    expect(noConsent.recommendedChannel).toBe("phone");
  });

  it("clamps the recency signal (very overdue customer never exceeds 100)", () => {
    const insight = scoreCustomer(record({ typicalReturnDays: 10 }, 4000));
    expect(insight.priorityScore).toBeLessThanOrEqual(100);
    expect(insight.priority).toBe("High");
  });

  it("classifies priority bands at the documented boundaries", () => {
    // Low band: barely overdue, low value, low loyalty, no VIP.
    const low = scoreCustomer(record({ averageTicketCents: 0, appointmentCount: 1, typicalReturnDays: 30 }, 33));
    expect(low.priority).toBe("Low");
  });
});

describe("rankOpportunities", () => {
  it("drops customers who are not overdue (daysOverdue === 0)", () => {
    const onCycle = record({ id: "cus_oncycle", typicalReturnDays: 30 }, 5); // 5 days since visit, cycle 30
    const overdue = record({ id: "cus_overdue", typicalReturnDays: 30 }, 120);
    const ranked = rankOpportunities([onCycle, overdue]);
    expect(ranked.map((c) => c.id)).toEqual(["cus_overdue"]);
  });

  it("sorts by priority score desc, then recoverable revenue desc", () => {
    const a = record({ id: "a", averageTicketCents: 5_000 }, 300);
    const b = record({ id: "b", averageTicketCents: 20_000 }, 300);
    const ranked = rankOpportunities([a, b]);
    // Same overdue profile; higher ticket => higher/tied score and higher revenue => ranks first.
    expect(ranked[0].id).toBe("b");
  });
});

import type { CustomerInsight, CustomerRecord, DailySummary, Priority } from "./types.js";
import { clamp, daysBetween, todayIso } from "./utils.js";

function classifyPriority(score: number): Priority {
  if (score >= 78) return "High";
  if (score >= 48) return "Medium";
  return "Low";
}

export function scoreCustomer(record: CustomerRecord): CustomerInsight {
  const daysSinceLastVisit = daysBetween(record.lastVisitDate);
  const daysOverdue = Math.max(0, daysSinceLastVisit - record.typicalReturnDays);
  const overdueRatio = daysOverdue / Math.max(record.typicalReturnDays, 1);
  const recencySignal = clamp(overdueRatio * 58, 0, 58);
  const valueSignal = clamp(record.averageTicketCents / 550, 0, 22);
  const loyaltySignal = clamp(record.appointmentCount * 2.4, 0, 12);
  const vipSignal = record.vip ? 8 : 0;
  const consentSignal = record.marketingConsent ? 0 : -12;
  const priorityScore = Math.round(clamp(recencySignal + valueSignal + loyaltySignal + vipSignal + consentSignal, 0, 100));
  const priority = classifyPriority(priorityScore);
  const rebookingLikelihood = Number(
    clamp(0.22 + overdueRatio * 0.18 + record.appointmentCount * 0.025 + (record.vip ? 0.08 : 0), 0.12, 0.91).toFixed(2)
  );
  const estimatedRecoverableRevenueCents = Math.round(record.averageTicketCents * rebookingLikelihood);
  const recommendedChannel = record.marketingConsent ? record.preferredChannel : "phone";

  return {
    ...record,
    daysSinceLastVisit,
    daysOverdue,
    priority,
    priorityScore,
    rebookingLikelihood,
    estimatedRecoverableRevenueCents,
    recommendedChannel,
    selectionReason: `${record.fullName} is ${daysOverdue} days past a normal ${record.typicalReturnDays}-day return cycle after a ${record.lastServiceType}.`
  };
}

export function rankOpportunities(records: CustomerRecord[]): CustomerInsight[] {
  return records
    .map(scoreCustomer)
    .filter((customer) => customer.daysOverdue > 0)
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      return b.estimatedRecoverableRevenueCents - a.estimatedRecoverableRevenueCents;
    });
}

export function summarizeOpportunities(opportunities: CustomerInsight[], recentlyContactedCount = 0): DailySummary {
  const high = opportunities.filter((customer) => customer.priority === "High").length;
  const medium = opportunities.filter((customer) => customer.priority === "Medium").length;
  const revenue = opportunities.reduce((sum, customer) => sum + customer.estimatedRecoverableRevenueCents, 0);

  return {
    generatedAt: todayIso(),
    overdueCustomerCount: opportunities.length,
    highPriorityCount: high,
    mediumPriorityCount: medium,
    estimatedRecoverableRevenueCents: revenue,
    recentlyContactedCount,
    topOpportunities: opportunities.slice(0, 10),
    recommendedActions: [
      `Start with the top ${Math.min(high || 3, 5)} high-priority customers before noon.`,
      "Use SMS for opted-in customers with short-cycle services; use phone follow-up for VIPs and customers without marketing consent.",
      "After each outreach, log contacted customers so tomorrow's report focuses on fresh opportunities."
    ]
  };
}


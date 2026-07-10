import { getCustomerRecord, getRecentlyContactedCustomerIds, listCustomerRecords, recordOutreach } from "./db.js";
import { draftOutreach } from "./outreach.js";
import { rankOpportunities, scoreCustomer, summarizeOpportunities } from "./scoring.js";
import type { CustomerInsight, DailySummary, Priority } from "./types.js";

/** Days a customer is suppressed from scans after being marked contacted (G-01). */
export const CONTACT_COOLDOWN_DAYS = 14;

export interface OpportunityFilters {
  priority?: Priority;
  vipOnly?: boolean;
  minDaysSinceLastVisit?: number;
  minDaysOverdue?: number;
  serviceType?: string;
  limit?: number;
  /** When true, include customers contacted within the cooldown window (e.g. "who have we already contacted?"). */
  includeContacted?: boolean;
}

/** ISO timestamp of the start of the current contact-cooldown window. */
function cooldownSinceIso(): string {
  return new Date(Date.now() - CONTACT_COOLDOWN_DAYS * 86_400_000).toISOString();
}

/** Ranked opportunities with recently-contacted customers removed, plus the count suppressed. */
function rankedWithSuppression(includeContacted = false): { opportunities: CustomerInsight[]; recentlyContactedCount: number } {
  const ranked = rankOpportunities(listCustomerRecords());
  if (includeContacted) return { opportunities: ranked, recentlyContactedCount: 0 };

  const contacted = getRecentlyContactedCustomerIds(cooldownSinceIso());
  const opportunities = ranked.filter((customer) => !contacted.has(customer.id));
  return { opportunities, recentlyContactedCount: ranked.length - opportunities.length };
}

export function getOpportunities(filters: OpportunityFilters = {}): CustomerInsight[] {
  let opportunities = rankedWithSuppression(filters.includeContacted).opportunities;

  if (filters.priority) {
    opportunities = opportunities.filter((customer) => customer.priority === filters.priority);
  }
  if (filters.vipOnly) {
    opportunities = opportunities.filter((customer) => customer.vip);
  }
  if (filters.minDaysSinceLastVisit !== undefined) {
    opportunities = opportunities.filter((customer) => customer.daysSinceLastVisit >= filters.minDaysSinceLastVisit!);
  }
  if (filters.minDaysOverdue !== undefined) {
    opportunities = opportunities.filter((customer) => customer.daysOverdue >= filters.minDaysOverdue!);
  }
  if (filters.serviceType) {
    opportunities = opportunities.filter((customer) =>
      customer.lastServiceType.toLowerCase().includes(filters.serviceType!.toLowerCase())
    );
  }

  return opportunities.slice(0, filters.limit ?? 10);
}

export function getDailySummary(): DailySummary {
  const { opportunities, recentlyContactedCount } = rankedWithSuppression();
  return summarizeOpportunities(opportunities, recentlyContactedCount);
}

export function getInsight(customerId: string): CustomerInsight | undefined {
  const record = getCustomerRecord(customerId);
  return record ? scoreCustomer(record) : undefined;
}

export function createOutreachDraft(customerId: string, tone?: string): { customer: CustomerInsight; message: string } {
  const customer = getInsight(customerId);
  if (!customer) throw new Error(`Customer ${customerId} was not found.`);
  return { customer, message: draftOutreach(customer, tone) };
}

export function markCustomerContacted(customerId: string, message: string, channel?: string): CustomerInsight {
  const customer = getInsight(customerId);
  if (!customer) throw new Error(`Customer ${customerId} was not found.`);
  recordOutreach(customer.id, channel ?? customer.recommendedChannel, message, "contacted");
  return customer;
}


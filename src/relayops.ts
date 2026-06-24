import { getCustomerRecord, listCustomerRecords, recordOutreach } from "./db.js";
import { draftOutreach } from "./outreach.js";
import { rankOpportunities, scoreCustomer, summarizeOpportunities } from "./scoring.js";
import type { CustomerInsight, DailySummary, Priority } from "./types.js";

export interface OpportunityFilters {
  priority?: Priority;
  vipOnly?: boolean;
  minDaysSinceLastVisit?: number;
  minDaysOverdue?: number;
  serviceType?: string;
  limit?: number;
}

export function getOpportunities(filters: OpportunityFilters = {}): CustomerInsight[] {
  let opportunities = rankOpportunities(listCustomerRecords());

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
  return summarizeOpportunities(rankOpportunities(listCustomerRecords()));
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


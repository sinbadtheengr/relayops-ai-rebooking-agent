export type CommunicationChannel = "sms" | "email" | "phone";
export type Priority = "High" | "Medium" | "Low";

export interface Customer {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  businessType: string;
  preferredChannel: CommunicationChannel;
  vip: boolean;
  typicalReturnDays: number;
  totalSpendCents: number;
  averageTicketCents: number;
  marketingConsent: boolean;
  notes: string;
  createdAt: string;
}

export interface Appointment {
  id: string;
  customerId: string;
  serviceType: string;
  serviceDate: string;
  revenueCents: number;
  staffMember: string;
  status: "completed" | "cancelled" | "no_show";
}

export interface CustomerRecord extends Customer {
  lastVisitDate: string;
  lastServiceType: string;
  appointmentCount: number;
}

export interface CustomerInsight extends CustomerRecord {
  daysSinceLastVisit: number;
  daysOverdue: number;
  priority: Priority;
  priorityScore: number;
  rebookingLikelihood: number;
  estimatedRecoverableRevenueCents: number;
  recommendedChannel: CommunicationChannel;
  selectionReason: string;
}

export interface DailySummary {
  generatedAt: string;
  overdueCustomerCount: number;
  highPriorityCount: number;
  mediumPriorityCount: number;
  estimatedRecoverableRevenueCents: number;
  topOpportunities: CustomerInsight[];
  recommendedActions: string[];
  /** Customers suppressed from this scan because they were contacted within the cooldown window (G-01). */
  recentlyContactedCount: number;
}


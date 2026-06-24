import type { CustomerInsight } from "./types.js";
import { formatCurrency } from "./utils.js";

export function draftOutreach(customer: CustomerInsight, tone = "warm and concise"): string {
  const firstName = customer.fullName.split(" ")[0];
  const service = customer.lastServiceType.toLowerCase();
  const valueCue = customer.vip ? "We always love having you in" : "We would be happy to get you back in";

  if (customer.recommendedChannel === "sms") {
    return `Hi ${firstName}, ${valueCue}. It has been a little while since your last ${service}, and we have a few openings this week. Would you like me to send over times?`;
  }

  if (customer.recommendedChannel === "email") {
    return `Subject: Ready for your next ${customer.lastServiceType}?\n\nHi ${firstName},\n\n${valueCue}. Based on your usual schedule, you may be due for another ${service}. We have availability this week and next if you would like to reserve a spot.\n\nReply with a good day or time and we will take care of the rest.`;
  }

  return `Call ${firstName} with a ${tone} reminder: mention their last ${service}, note that they are about ${customer.daysOverdue} days past their usual return cycle, and offer two specific appointment windows. Expected recovery value: ${formatCurrency(customer.estimatedRecoverableRevenueCents)}.`;
}


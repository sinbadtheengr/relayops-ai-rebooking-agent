import type { CustomerInsight } from "./types.js";

export const TEMPLATE_VERSION = "med-spa-rebooking-v1";
export interface Sender { senderName: string; mailingAddress: string; contactEmail: string }

export function draftOutreach(customer: CustomerInsight, sender: Sender): string {
  const firstName = customer.fullName.trim().split(/\s+/)[0];
  const prefix = customer.recommendedChannel === "email" ? "Subject: Would you like to book a return visit?\n\n" : "";
  return `${prefix}Hi ${firstName}, this is ${sender.senderName}. Would you like to book a return visit? Reply if you'd like us to check available times.\n\n${sender.senderName}\n${sender.mailingAddress}\n${sender.contactEmail}\nReply STOP to unsubscribe.`;
}

import type { KnownBlock } from "@slack/types";
import type { CustomerInsight, DailySummary } from "./types.js";
import { createOutreachDraft } from "./relayops.js";
import { formatCurrency, formatDate } from "./utils.js";

function priorityEmoji(priority: string): string {
  if (priority === "High") return ":rotating_light:";
  if (priority === "Medium") return ":large_yellow_circle:";
  return ":large_green_circle:";
}

export function customerBlocks(customer: CustomerInsight): KnownBlock[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${priorityEmoji(customer.priority)} *${customer.fullName}* · ${customer.priority} priority · score ${customer.priorityScore}\n${customer.selectionReason}\n*Best channel:* ${customer.recommendedChannel.toUpperCase()} · *Likelihood:* ${Math.round(
          customer.rebookingLikelihood * 100
        )}% · *Recovery:* ${formatCurrency(customer.estimatedRecoverableRevenueCents)}`
      }
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Last visit ${formatDate(customer.lastVisitDate)} · ${customer.lastServiceType} · ${customer.appointmentCount} completed visits · ${customer.vip ? "VIP" : "Standard"}`
        }
      ]
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Draft outreach" },
          action_id: "draft_customer",
          value: customer.id
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Mark contacted" },
          style: "primary",
          action_id: "mark_contacted",
          value: customer.id
        }
      ]
    }
  ];
}

export function dailySummaryBlocks(summary: DailySummary): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "RelayOps Daily Rebooking Scan" }
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${summary.overdueCustomerCount}* overdue customers · *${summary.highPriorityCount}* high priority · *${formatCurrency(
          summary.estimatedRecoverableRevenueCents
        )}* recoverable revenue`
      }
    },
    { type: "divider" }
  ];

  for (const customer of summary.topOpportunities.slice(0, 5)) {
    blocks.push(...customerBlocks(customer), { type: "divider" });
  }

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*Recommended actions*\n${summary.recommendedActions.map((action) => `• ${action}`).join("\n")}`
    }
  });

  return blocks;
}

export function outreachDraftBlocks(customerId: string): KnownBlock[] {
  const { customer, message } = createOutreachDraft(customerId);
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Draft for ${customer.fullName} via ${customer.recommendedChannel.toUpperCase()}*\n${message}`
      }
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Mark contacted" },
          style: "primary",
          action_id: "mark_contacted",
          value: customer.id
        }
      ]
    }
  ];
}


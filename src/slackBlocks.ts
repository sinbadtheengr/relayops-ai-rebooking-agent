import type { KnownBlock } from "@slack/types";
import type { CustomerInsight, DailySummary } from "./types.js";
import { formatCurrency, formatDate } from "./utils.js";

function priorityEmoji(priority: string): string {
  if (priority === "High") return ":rotating_light:";
  if (priority === "Medium") return ":large_yellow_circle:";
  return ":large_green_circle:";
}

export function customerBlocks(customer: CustomerInsight, clientId: string): KnownBlock[] {
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
          text: `Customer ID ${customer.id} · Last visit ${formatDate(customer.lastVisitDate)} · ${customer.lastServiceType} · ${customer.appointmentCount} completed visits · ${customer.vip ? "VIP" : "Standard"}`
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
          value: `${clientId}/${customer.id}`
        }
      ]
    }
  ];
}

/** Single mrkdwn line summarizing the scan headline stats. */
function summaryHeadline(summary: DailySummary): string {
  const base = `*${summary.overdueCustomerCount}* overdue customers · *${summary.highPriorityCount}* high priority · *${formatCurrency(
    summary.estimatedRecoverableRevenueCents
  )}* recoverable revenue`;
  return summary.recentlyContactedCount > 0
    ? `${base}\n:white_check_mark: ${summary.recentlyContactedCount} already contacted this cycle — suppressed from this scan.`
    : base;
}

export function dailySummaryBlocks(summary: DailySummary, clientId: string): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "RelayOps Daily Rebooking Scan" }
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: summaryHeadline(summary) }
    },
    { type: "divider" }
  ];

  for (const customer of summary.topOpportunities.slice(0, 5)) {
    blocks.push(...customerBlocks(customer, clientId), { type: "divider" });
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

/**
 * App Home dashboard: a persistent, per-user view of today's rebooking opportunities.
 * Pure function of a DailySummary — the caller fetches the data (keeps the view layer I/O-free).
 */
export function homeDashboardBlocks(summary: DailySummary, clientId: string): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: ":dart: RelayOps — Rebooking Command Center" }
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: `Snapshot for ${formatDate(summary.generatedAt)} · updated when you open this tab` }]
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Recoverable revenue*\n${formatCurrency(summary.estimatedRecoverableRevenueCents)}` },
        { type: "mrkdwn", text: `*Overdue customers*\n${summary.overdueCustomerCount}` },
        { type: "mrkdwn", text: `*High priority*\n${summary.highPriorityCount}` },
        { type: "mrkdwn", text: `*Already contacted*\n${summary.recentlyContactedCount} (suppressed)` }
      ]
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: ":arrows_counterclockwise: Refresh" },
          action_id: "refresh_home"
        }
      ]
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: "*Top opportunities to contact today*" }
    }
  ];

  if (summary.topOpportunities.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "No clients are eligible for rebooking outreach right now." }
    });
    return blocks;
  }

  for (const customer of summary.topOpportunities.slice(0, 5)) {
    blocks.push(...customerBlocks(customer, clientId), { type: "divider" });
  }

  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: "RelayOps drafts outreach for staff review and never messages customers automatically." }]
  });

  return blocks;
}

export function outreachDraftBlocks(draft: { id: string; customer: CustomerInsight; message: string }, clientId: string): KnownBlock[] {
  const { customer, message } = draft;
  return [
    {
      type: "section",
      text: {
        type: "plain_text",
        text: `Draft ${draft.id} for ${customer.fullName} via ${customer.recommendedChannel.toUpperCase()}\n\n${message}`
      }
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Approve this text" },
          style: "primary",
          action_id: "approve_message",
          value: `${clientId}/${draft.id}`
        }
      ]
    }
  ];
}

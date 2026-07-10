import OpenAI from "openai";
import { config } from "./config.js";
import { createOutreachDraft, getDailySummary, getOpportunities } from "./relayops.js";
import { formatCurrency, formatDate } from "./utils.js";
import type { CustomerInsight, Priority } from "./types.js";

function hasUsableOpenAiKey(apiKey: string | undefined): apiKey is string {
  const key = apiKey?.trim();
  return Boolean(key && key.length > 20 && key.startsWith("sk-") && !key.toLowerCase().includes("your"));
}

const openai = hasUsableOpenAiKey(config.openAiApiKey) ? new OpenAI({ apiKey: config.openAiApiKey }) : null;

function customerLine(customer: CustomerInsight): string {
  return `*${customer.fullName}* (${customer.priority}, score ${customer.priorityScore}) - last visit ${customer.daysSinceLastVisit} days ago, ${customer.daysOverdue} days overdue, likely ${Math.round(
    customer.rebookingLikelihood * 100
  )}%, recovery ${formatCurrency(customer.estimatedRecoverableRevenueCents)}.`;
}

export function formatDailySummaryText(): string {
  const summary = getDailySummary();
  const top = summary.topOpportunities.slice(0, 5).map(customerLine).join("\n");

  return [
    `*RelayOps Daily Rebooking Scan* (${formatDate(summary.generatedAt)})`,
    `${summary.overdueCustomerCount} overdue customers found. ${summary.highPriorityCount} high priority, ${summary.mediumPriorityCount} medium priority.`,
    `Estimated recoverable revenue: *${formatCurrency(summary.estimatedRecoverableRevenueCents)}*.`,
    ...(summary.recentlyContactedCount > 0
      ? [`${summary.recentlyContactedCount} recently-contacted customers suppressed from this scan.`]
      : []),
    "",
    top || "No overdue customers today.",
    "",
    "*Recommended actions:*",
    ...summary.recommendedActions.map((action) => `• ${action}`)
  ].join("\n");
}

function parseDeterministicIntent(question: string): string {
  const normalized = question.toLowerCase();
  const filters: { priority?: Priority; vipOnly?: boolean; minDaysSinceLastVisit?: number; limit?: number } = { limit: 8 };

  if (normalized.includes("high")) filters.priority = "High";
  if (normalized.includes("medium")) filters.priority = "Medium";
  if (normalized.includes("vip")) filters.vipOnly = true;
  if (normalized.includes("90")) filters.minDaysSinceLastVisit = 90;
  if (normalized.includes("today") || normalized.includes("contact")) filters.limit = 10;

  if (normalized.includes("summary") || normalized.includes("opportunities") || normalized.includes("recoverable revenue")) {
    return formatDailySummaryText();
  }

  if (normalized.includes("draft")) {
    const top = getOpportunities({ priority: filters.priority, vipOnly: filters.vipOnly, limit: 1 })[0];
    if (!top) return "I did not find an overdue customer matching that request.";
    const draft = createOutreachDraft(top.id);
    return `*Draft for ${draft.customer.fullName} via ${draft.customer.recommendedChannel}:*\n${draft.message}`;
  }

  const opportunities = getOpportunities(filters);
  if (opportunities.length === 0) return "I did not find overdue customers matching that request.";

  return [
    "*Customers to contact:*",
    ...opportunities.map(customerLine),
    "",
    "Ask me to draft a follow-up message for the top customer or filter by VIP, high priority, or 90 days."
  ].join("\n");
}

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_rebooking_opportunities",
      description: "Find customers overdue for rebooking, filtered by priority, VIP status, service, or days since last visit.",
      parameters: {
        type: "object",
        properties: {
          priority: { type: "string", enum: ["High", "Medium", "Low"] },
          vipOnly: { type: "boolean" },
          minDaysSinceLastVisit: { type: "number" },
          minDaysOverdue: { type: "number" },
          serviceType: { type: "string" },
          limit: { type: "number" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "draft_follow_up",
      description: "Create personalized outreach for a specific customer.",
      parameters: {
        type: "object",
        required: ["customerId"],
        properties: {
          customerId: { type: "string" },
          tone: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "summarize_today",
      description: "Summarize today's revenue recovery opportunity and recommended actions.",
      parameters: { type: "object", properties: {} }
    }
  }
];

function runTool(name: string, rawArgs: string | undefined): unknown {
  const args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
  if (name === "get_rebooking_opportunities") {
    return getOpportunities({
      priority: args.priority as Priority | undefined,
      vipOnly: args.vipOnly as boolean | undefined,
      minDaysSinceLastVisit: args.minDaysSinceLastVisit as number | undefined,
      minDaysOverdue: args.minDaysOverdue as number | undefined,
      serviceType: args.serviceType as string | undefined,
      limit: (args.limit as number | undefined) ?? 8
    });
  }
  if (name === "draft_follow_up") {
    return createOutreachDraft(args.customerId as string, args.tone as string | undefined);
  }
  if (name === "summarize_today") {
    return getDailySummary();
  }
  throw new Error(`Unknown tool ${name}`);
}

export async function answerBusinessQuestion(question: string): Promise<string> {
  if (!openai) return parseDeterministicIntent(question);

  try {
    const first = await openai.chat.completions.create({
      model: config.openAiModel,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are RelayOps, a Slack-native AI rebooking employee for small businesses. Use tools for all customer facts. Be concise, operational, and ROI-focused. Never invent customers."
        },
        { role: "user", content: question }
      ],
      tools,
      tool_choice: "auto"
    });

    const message = first.choices[0]?.message;
    const toolCalls = message?.tool_calls ?? [];
    if (toolCalls.length === 0) return message?.content ?? parseDeterministicIntent(question);

    const toolMessages: OpenAI.Chat.Completions.ChatCompletionToolMessageParam[] = toolCalls.map((call) => ({
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify(runTool(call.function.name, call.function.arguments))
    }));

    const final = await openai.chat.completions.create({
      model: config.openAiModel,
      temperature: 0.25,
      messages: [
        {
          role: "system",
          content:
            "Format the Slack response with short bullets. Include why customers were selected, best channel, likelihood, and revenue when relevant."
        },
        { role: "user", content: question },
        message,
        ...toolMessages
      ]
    });

    return final.choices[0]?.message.content ?? parseDeterministicIntent(question);
  } catch {
    console.warn("OpenAI request failed; using local RelayOps fallback response.");
    return parseDeterministicIntent(question);
  }
}

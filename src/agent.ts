import OpenAI from "openai";
import { z } from "zod";
import { config } from "./config.js";
import {
  CONTACT_COOLDOWN_DAYS,
  createOutreachDraft,
  getDailySummary,
  getInsight,
  getOpportunities,
  listRecentlyContacted
} from "./relayops.js";
import { clamp, formatCurrency, formatDate } from "./utils.js";
import type { CustomerInsight } from "./types.js";

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
  const filters: { priority?: "High" | "Medium" | "Low"; vipOnly?: boolean; minDaysSinceLastVisit?: number; limit?: number } = {
    limit: 8
  };

  if (normalized.includes("high")) filters.priority = "High";
  if (normalized.includes("medium")) filters.priority = "Medium";
  if (normalized.includes("vip")) filters.vipOnly = true;
  if (normalized.includes("90")) filters.minDaysSinceLastVisit = 90;
  if (normalized.includes("today") || normalized.includes("contact")) filters.limit = 10;

  // "Who have we already contacted?" must NOT return the to-contact list —
  // it asks about the suppressed set. Checked before the general branches.
  if (normalized.includes("contacted") || normalized.includes("suppressed")) {
    const contacted = listRecentlyContacted();
    if (contacted.length === 0) return "No customers have been marked contacted within the cooldown window.";
    return [
      `*Recently contacted — suppressed from scans for ${CONTACT_COOLDOWN_DAYS} days:*`,
      ...contacted.map(customerLine)
    ].join("\n");
  }

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
    "Ask me to draft a follow-up message for the top customer, list who we already contacted, or filter by VIP, high priority, or 90 days."
  ].join("\n");
}

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_rebooking_opportunities",
      description:
        "Find customers overdue for rebooking, filtered by priority, VIP status, service, or days since last visit. Recently-contacted customers are suppressed unless includeContacted is true.",
      parameters: {
        type: "object",
        properties: {
          priority: { type: "string", enum: ["High", "Medium", "Low"] },
          vipOnly: { type: "boolean" },
          minDaysSinceLastVisit: { type: "number" },
          minDaysOverdue: { type: "number" },
          serviceType: { type: "string" },
          includeContacted: { type: "boolean", description: "Include customers contacted within the cooldown window" },
          limit: { type: "number", description: "1-25, default 8" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "draft_follow_up",
      description:
        "Create personalized outreach for a specific customer, for staff review. Requires a customer id from get_rebooking_opportunities.",
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
  },
  {
    type: "function",
    function: {
      name: "list_recently_contacted",
      description:
        "List customers who were marked contacted within the cooldown window and are therefore suppressed from the daily scan.",
      parameters: { type: "object", properties: {} }
    }
  }
];

// Tool arguments are unvalidated model output (G-07): coerce what is safely
// coercible (priority case, limit bounds) and reject the rest with an {error}
// tool result the model can recover from — never a throw.
const opportunityArgsSchema = z.object({
  priority: z
    .preprocess(
      (value) => (typeof value === "string" ? `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}` : value),
      z.enum(["High", "Medium", "Low"])
    )
    .optional(),
  vipOnly: z.boolean().optional(),
  minDaysSinceLastVisit: z.number().min(0).optional(),
  minDaysOverdue: z.number().min(0).optional(),
  serviceType: z.string().optional(),
  includeContacted: z.boolean().optional(),
  limit: z
    .number()
    .optional()
    .transform((value) => (value === undefined ? 8 : Math.round(clamp(value, 1, 25))))
});

const draftArgsSchema = z.object({
  customerId: z.string().min(1),
  tone: z.string().optional()
});

function zodIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "args"}: ${issue.message}`).join("; ");
}

/** Execute a tool call. Always returns a JSON-serializable result; failures become {error} so the model can recover. */
function runTool(name: string, rawArgs: string | undefined): unknown {
  try {
    const args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};

    if (name === "get_rebooking_opportunities") {
      const parsed = opportunityArgsSchema.safeParse(args);
      if (!parsed.success) return { error: zodIssues(parsed.error) };
      return getOpportunities(parsed.data);
    }

    if (name === "draft_follow_up") {
      const parsed = draftArgsSchema.safeParse(args);
      if (!parsed.success) return { error: zodIssues(parsed.error) };
      if (!getInsight(parsed.data.customerId)) {
        return { error: `No customer with id ${parsed.data.customerId}. Use get_rebooking_opportunities to find valid ids.` };
      }
      return createOutreachDraft(parsed.data.customerId, parsed.data.tone);
    }

    if (name === "summarize_today") return getDailySummary();
    if (name === "list_recently_contacted") return listRecentlyContacted();

    return { error: `Unknown tool ${name}` };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const SYSTEM_PROMPT =
  "You are RelayOps, a Slack-native AI rebooking employee for small businesses. Use tools for all customer facts — never invent customers. Chain tools when needed: find opportunities first to get customer ids, then draft follow-ups. Be concise, operational, and ROI-focused. Format Slack responses with short bullets, and include why customers were selected, best channel, likelihood, and revenue when relevant.";

/** Max completion rounds per question. Each round may request tools; the loop ends when the model answers in prose (G-06). */
const MAX_TOOL_ROUNDS = 4;

export async function answerBusinessQuestion(question: string): Promise<string> {
  if (!openai) return parseDeterministicIntent(question);

  try {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: question }
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const completion = await openai.chat.completions.create({
        model: config.openAiModel,
        temperature: 0.2,
        messages,
        tools,
        tool_choice: "auto"
      });

      const message = completion.choices[0]?.message;
      if (!message) break;

      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        return message.content ?? parseDeterministicIntent(question);
      }

      messages.push(message);
      for (const call of toolCalls) {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(runTool(call.function.name, call.function.arguments))
        });
      }
    }

    // Round budget exhausted with the model still requesting tools: one last
    // completion without tools so the user always gets grounded prose.
    const final = await openai.chat.completions.create({
      model: config.openAiModel,
      temperature: 0.25,
      messages
    });
    return final.choices[0]?.message.content ?? parseDeterministicIntent(question);
  } catch (error) {
    console.warn("OpenAI request failed; using local RelayOps fallback response:", error);
    return parseDeterministicIntent(question);
  }
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createOutreachDraft,
  getDailySummary,
  getInsight,
  getOpportunities,
  listRecentlyContacted,
  markCustomerContacted
} from "../relayops.js";
import { formatCurrency, formatDate } from "../utils.js";
import type { CustomerInsight, Priority } from "../types.js";

/**
 * RelayOps MCP server — a thin adapter that exposes the SAME domain service layer
 * the Slack app uses (`src/relayops.ts`) to any MCP client (Claude Desktop, etc.).
 * No SQL, no business logic here: parse args → call services → return readable text.
 * Product invariant preserved: no tool sends customer messages — drafts and internal
 * logs only. Runs fully offline (no OpenAI key required).
 */

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

function insightLine(c: CustomerInsight): string {
  return `• ${c.fullName} (id ${c.id}) — ${c.priority} priority, score ${c.priorityScore}, ${c.daysOverdue} days overdue, ${Math.round(
    c.rebookingLikelihood * 100
  )}% likely, recovery ${formatCurrency(c.estimatedRecoverableRevenueCents)}, best channel ${c.recommendedChannel.toUpperCase()}`;
}

/** Resolve a customer by exact id, else by case-insensitive name match among opportunities. */
function resolveCustomer(query: string): CustomerInsight | { error: string } {
  const byId = getInsight(query);
  if (byId) return byId;

  const needle = query.toLowerCase().trim();
  const match = getOpportunities({ includeContacted: true, limit: 1000 }).find((c) =>
    c.fullName.toLowerCase().includes(needle)
  );
  return match ?? { error: `No customer matching "${query}". Use get_rebooking_opportunities to see valid ids and names.` };
}

export function createRelayOpsMcpServer(): McpServer {
  const server = new McpServer({ name: "relayops", version: "0.1.0" });

  server.registerTool(
    "get_rebooking_opportunities",
    {
      description:
        "List customers overdue for rebooking, ranked by priority and recoverable revenue. Filter by priority, VIP status, service, or how overdue they are. Recently-contacted customers are suppressed unless includeContacted is true.",
      inputSchema: {
        priority: z.enum(["High", "Medium", "Low"]).optional(),
        vipOnly: z.boolean().optional(),
        minDaysSinceLastVisit: z.number().int().nonnegative().optional(),
        minDaysOverdue: z.number().int().nonnegative().optional(),
        serviceType: z.string().optional(),
        includeContacted: z.boolean().optional().describe("Include customers contacted within the cooldown window"),
        limit: z.number().int().min(1).max(25).optional().describe("1–25, default 8")
      }
    },
    async (args) => {
      const opportunities = getOpportunities({
        priority: args.priority as Priority | undefined,
        vipOnly: args.vipOnly,
        minDaysSinceLastVisit: args.minDaysSinceLastVisit,
        minDaysOverdue: args.minDaysOverdue,
        serviceType: args.serviceType,
        includeContacted: args.includeContacted,
        limit: args.limit ?? 8
      });
      if (opportunities.length === 0) return text("No overdue customers match those filters.");
      return text([`${opportunities.length} rebooking opportunities:`, ...opportunities.map(insightLine)].join("\n"));
    }
  );

  server.registerTool(
    "summarize_today",
    {
      description:
        "Snapshot of today's rebooking opportunity: overdue count, priority breakdown, total recoverable revenue, and how many customers were suppressed because they were recently contacted.",
      inputSchema: {}
    },
    async () => {
      const s = getDailySummary();
      const lines = [
        `RelayOps daily rebooking scan (${formatDate(s.generatedAt)}):`,
        `- ${s.overdueCustomerCount} overdue customers (${s.highPriorityCount} high, ${s.mediumPriorityCount} medium)`,
        `- Estimated recoverable revenue: ${formatCurrency(s.estimatedRecoverableRevenueCents)}`,
        `- ${s.recentlyContactedCount} recently-contacted customers suppressed from this scan`,
        "",
        "Top opportunities:",
        ...s.topOpportunities.slice(0, 5).map(insightLine)
      ];
      return text(lines.join("\n"));
    }
  );

  server.registerTool(
    "draft_follow_up",
    {
      description:
        "Draft a personalized rebooking message for a customer, for STAFF REVIEW. Accepts a customer id or name. This never sends anything — it returns a draft a human approves and sends.",
      inputSchema: {
        customer: z.string().describe("Customer id (e.g. cus_004) or full name"),
        tone: z.string().optional().describe("Optional tone hint, e.g. warm, concise, celebratory")
      }
    },
    async ({ customer, tone }) => {
      const resolved = resolveCustomer(customer);
      if ("error" in resolved) return text(resolved.error);
      const draft = createOutreachDraft(resolved.id, tone);
      return text(
        `Draft for ${draft.customer.fullName} via ${draft.customer.recommendedChannel.toUpperCase()} (review before sending):\n\n${draft.message}`
      );
    }
  );

  server.registerTool(
    "list_recently_contacted",
    {
      description:
        "List customers who were marked contacted within the cooldown window and are therefore suppressed from the daily scan.",
      inputSchema: {}
    },
    async () => {
      const suppressed = listRecentlyContacted();
      if (suppressed.length === 0) return text("No customers have been contacted within the cooldown window.");
      return text([`${suppressed.length} recently-contacted (suppressed):`, ...suppressed.map(insightLine)].join("\n"));
    }
  );

  server.registerTool(
    "mark_contacted",
    {
      description:
        "Log that staff contacted a customer (INTERNAL LOG ONLY — does not message the customer). Suppresses them from the daily scan for the cooldown window. Accepts a customer id or name.",
      inputSchema: {
        customer: z.string().describe("Customer id (e.g. cus_004) or full name"),
        note: z.string().optional().describe("Optional note about the outreach")
      }
    },
    async ({ customer, note }) => {
      const resolved = resolveCustomer(customer);
      if ("error" in resolved) return text(resolved.error);
      const updated = markCustomerContacted(resolved.id, note ?? "Marked contacted via MCP");
      return text(`Logged ${updated.fullName} (id ${updated.id}) as contacted. They will drop out of the scan for the cooldown window.`);
    }
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createRelayOpsMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the protocol stream.
  console.error("[relayops-mcp] RelayOps MCP server running on stdio");
}

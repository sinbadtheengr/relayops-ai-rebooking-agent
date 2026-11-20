import { config } from "./config.js";
import { answerBusinessQuestion } from "./agent.js";
import {
  approveDraft,
  audit,
  cancelDelivery,
  confirmSent,
  createOutreachDraft,
  getDailySummary,
  recordOptOut,
  recordReply,
  releaseMessage
} from "./relayops.js";
import { dailySummaryBlocks, outreachDraftBlocks } from "./slackBlocks.js";
import { weeklyReport, weeklyText } from "./weekly.js";
import type { KnownBlock } from "@slack/types";

export function authorized(team: unknown, user: unknown) {
  return Boolean(
    config.teamId && team === config.teamId && typeof user === "string" && config.staff.includes(user)
  );
}

export async function staffCommand(input: string): Promise<{ text: string; blocks?: KnownBlock[] }> {
  const [verb = "scan", id = "", ...rest] = input.trim().split(/\s+/);
  if (!verb || verb === "scan")
    return { text: "Daily rebooking scan", blocks: dailySummaryBlocks(getDailySummary(), config.clientId) };
  if (verb === "weekly") return { text: weeklyText(weeklyReport(id || undefined)) };
  if (verb === "draft" && id && !rest.length) {
    const draft = createOutreachDraft(id);
    return {
      text: `Draft ${draft.id} for ${draft.customer.fullName}\n\n${draft.message}\n\nApprove with /relayops approve ${draft.id}.`,
      blocks: outreachDraftBlocks(draft, config.clientId)
    };
  }
  if (verb === "approve") {
    approveDraft(id);
    return {
      text: `Approved. When ready to send, run /relayops deliver ${id} to check eligibility and claim delivery.`
    };
  }
  if (verb === "deliver") {
    const m = releaseMessage(id);
    const instruction = m.alreadyClaimed
      ? "You already claimed this delivery. Check the sent folder before taking further action."
      : "Check for new opt-outs, then send this exact copy once.";
    const heading = `${m.channel.toUpperCase()} to ${m.destination}. ${instruction}`;
    const footer = `After sending, run /relayops sent ${id}. If unsent, use /relayops cancel ${id}.`;
    return {
      text: [heading, m.body, footer].join("\n\n"),
      blocks: [heading, m.body, footer].map((text) => ({
        type: "section",
        text: { type: "plain_text", text }
      }))
    };
  }
  if (verb === "sent") {
    confirmSent(id, rest[0]);
    return { text: `Manual send recorded. Message ID ${id}.` };
  }
  if (verb === "cancel") {
    cancelDelivery(id);
    return { text: "Unsent draft closed." };
  }
  if (verb === "optout") {
    const [at, ...source] = rest;
    recordOptOut(id, source.join(" "), at);
    return { text: "Withdrawal recorded. Outreach is suppressed." };
  }
  if (verb === "reply") {
    const [kind, ref, at] = rest;
    if (!at || (kind !== "reply" && kind !== "optout"))
      throw new Error("Use reply MESSAGE_ID reply|optout REFERENCE RECEIVED_AT.");
    recordReply(id, ref, at, kind);
    return { text: kind === "optout" ? "Reply and withdrawal recorded." : "Reply recorded." };
  }
  audit("question", "");
  return { text: await answerBusinessQuestion(input) };
}

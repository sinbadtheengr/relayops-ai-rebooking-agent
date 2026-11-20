import { createHash } from "node:crypto";
import { actorId, requireStaff } from "./actor.js";
import { config, senderIdentity } from "./config.js";
import {
  action,
  addEvent,
  addReply,
  audit,
  eventFor,
  insertMessage,
  loadState,
  messageById,
  saveExport,
  withdraw
} from "./db.js";
import { snapshot } from "./eligibility.js";
import { parseExport, timestamp } from "./importCsv.js";
import { draftOutreach, TEMPLATE_VERSION } from "./outreach.js";
import { summarizeOpportunities } from "./scoring.js";
import type { Priority } from "./types.js";
import { todayIso } from "./utils.js";
export { CONTACT_COOLDOWN_DAYS } from "./eligibility.js";
export { messageRecord, auditTrail } from "./db.js";

const now = () => new Date().toISOString();
const digest = (v: string) => createHash("sha256").update(v).digest("hex");

export function importBookings(client: string, csv: string, exportedAt: string) {
  const hash = digest(csv);
  return action("csv.import", hash, () => {
    requireStaff();
    if (client !== config.clientId) throw new Error("Import client does not match the configured client.");
    const asOf = timestamp(exportedAt);
    if (asOf > now()) throw new Error("Export timestamp is in the future.");
    return saveExport(parseExport(csv, client, asOf, todayIso(new Date(asOf))), asOf, hash);
  });
}
export interface OpportunityFilters {
  priority?: Priority;
  vipOnly?: boolean;
  minDaysSinceLastVisit?: number;
  minDaysOverdue?: number;
  serviceType?: string;
  limit?: number;
  includeContacted?: boolean;
}
export function getOpportunities(f: OpportunityFilters = {}) {
  return action("opportunities.read", "", () =>
    snapshot()
      .filter(
        (row) => row.contactable || (f.includeContacted && row.overdue && row.consent && row.recentlyContacted)
      )
      .map((r) => r.customer)
      .filter(
        (c) =>
          (!f.priority || f.priority === c.priority) &&
          (!f.vipOnly || c.vip) &&
          c.daysSinceLastVisit >= (f.minDaysSinceLastVisit ?? 0) &&
          c.daysOverdue >= (f.minDaysOverdue ?? 0) &&
          c.lastServiceType.toLowerCase().includes(f.serviceType?.toLowerCase() ?? "")
      )
      .slice(0, f.limit ?? 10)
  );
}
export function listRecentlyContacted() {
  return action("contacts.recent", "", () =>
    snapshot()
      .filter((r) => r.overdue && r.recentlyContacted)
      .map((r) => r.customer)
  );
}
export function getDailySummary() {
  return action("scan", "", () => {
    const rows = snapshot();
    const summary = summarizeOpportunities(
      rows.filter((r) => r.contactable).map((r) => r.customer),
      rows.filter((r) => r.overdue && r.recentlyContacted).length
    );
    return { ...summary, overdueCustomerCount: rows.filter((r) => r.overdue).length };
  });
}
export function getInsight(id: string) {
  return action("customer.read", id, () => snapshot().find((r) => r.customer.id === id)?.customer);
}

function eligible(id: string, ownHold?: string) {
  const row = snapshot(now(), ownHold).find((r) => r.customer.id === id);
  if (!row?.contactable)
    throw new Error("Customer is no longer eligible. Check consent, withdrawals, bookings and recent outreach.");
  return row;
}

export function createOutreachDraft(customerId: string, _tone?: string) {
  return action("draft", customerId, () => {
    const { customer, proof } = eligible(customerId);
    const sender = senderIdentity();
    const body = draftOutreach(customer, sender);
    const row = insertMessage({
      customer: customerId,
      channel: customer.preferredChannel,
      destination: proof.destination,
      body,
      template: TEMPLATE_VERSION,
      hash: digest(body),
      sender: JSON.stringify(sender),
      evidence: JSON.stringify(proof)
    });
    return { id: row.id, customer, message: body };
  });
}

function recheck(id: string) {
  const m = messageById(id);
  if (eventFor(id, "sent")) throw new Error("This message has already been sent.");
  const { proof, customer } = eligible(m.customer, id);
  if (
    eventFor(id, "cancelled") ||
    JSON.parse(m.evidence).profileBatch !== proof.profileBatch ||
    m.destination !== proof.destination ||
    m.body !== draftOutreach(customer, senderIdentity())
  ) {
    throw new Error("This draft is stale. Create a new draft for review.");
  }
  return { m, evidence: JSON.stringify(proof) };
}

export function approveDraft(id: string) {
  return action("message.approve", id, () => {
    requireStaff();
    const { evidence } = recheck(id);
    if (!eventFor(id, "approved")) addEvent(id, "approved", evidence);
  });
}

// A single staff member claims the approved copy before manual delivery. The hold
// survives a restart and excludes competing drafts for this recipient.
export function releaseMessage(id: string) {
  return action("message.release", id, () => {
    requireStaff();
    if (!eventFor(id, "approved")) throw new Error("Staff approval is required before delivery.");
    const { m, evidence } = recheck(id);
    const hold = eventFor(id, "released");
    if (hold && hold.actor !== actorId()) throw new Error("Another staff member has this delivery.");
    if (!hold) addEvent(id, "released", evidence);
    return { destination: m.destination, channel: m.channel, body: m.body, alreadyClaimed: Boolean(hold) };
  });
}

export function confirmSent(id: string, deliveredAt = now()) {
  return action("message.confirm_sent", id, () => {
    requireStaff();
    const release = eventFor(id, "released");
    if (!release || release.actor !== actorId() || eventFor(id, "cancelled"))
      throw new Error("Confirm your own approved delivery handoff.");
    if (eventFor(id, "sent")) return;
    const at = timestamp(deliveredAt);
    if (at < release.at || at > now()) throw new Error("Delivery time must be between handoff and now.");
    const m = messageById(id);
    const row = snapshot(at, id).find((r) => r.customer.id === m.customer);
    if (!row?.contactable || row.proof.profileBatch !== JSON.parse(release.evidence).profileBatch) {
      throw new Error("Consent or eligibility changed before the stated delivery time.");
    }
    addEvent(id, "sent", JSON.stringify(row.proof), at);
  });
}

export function cancelDelivery(id: string) {
  return action("message.cancel_unsent", id, () => {
    requireStaff();
    messageById(id);
    const hold = eventFor(id, "released");
    if (eventFor(id, "sent") || (hold && hold.actor !== actorId()))
      throw new Error("Only an unsent draft or your own unsent handoff can be closed.");
    if (!eventFor(id, "cancelled")) addEvent(id, "cancelled", "{}");
  });
}
export function recordOptOut(customerId: string, source: string, receivedAt = now()) {
  return action("customer.opt_out", customerId, () => {
    requireStaff();
    const at = timestamp(receivedAt);
    if (at > now() || !source.trim() || source.length > 500)
      throw new Error("Provide the withdrawal source and a valid received time.");
    const profile = loadState(now()).profiles.find((p) => p.value.id === customerId)?.value;
    if (!profile) throw new Error("Unknown customer ID.");
    withdraw(profile, at, source, null);
  });
}

export function recordReply(id: string, reference: string, receivedAt: string, kind: "reply" | "optout") {
  return action("message.reply", id, () => {
    requireStaff();
    const sent = eventFor(id, "sent");
    const at = timestamp(receivedAt);
    if (!sent || at < sent.at || at > now()) throw new Error("Reply time must follow a confirmed send.");
    if (!reference.trim() || reference.length > 200 || !["reply", "optout"].includes(kind))
      throw new Error("Invalid reply reference or kind.");
    addReply(id, reference, at, kind);
    if (kind === "optout") {
      const m = messageById(id);
      withdraw(
        {
          id: m.customer,
          email: m.channel === "email" ? m.destination : "",
          phone: m.channel === "sms" ? m.destination : ""
        },
        at,
        "reply:" + reference,
        id
      );
    }
  });
}

export { audit };

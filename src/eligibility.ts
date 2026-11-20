import { loadState } from "./db.js";
import type { Profile } from "./importCsv.js";
import type { CustomerRecord } from "./types.js";
import { todayIso } from "./utils.js";
import { scoreCustomer } from "./scoring.js";

export const CONTACT_COOLDOWN_DAYS = 14;
const dayMs = 86_400_000;

// Expire at the beginning of the local anniversary day, clamped to month end.
function consentEnd(granted: string, months: number) {
  const d = new Date(todayIso(new Date(granted)) + "T00:00:00Z");
  const date = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months + 1, 0);
  d.setUTCDate(Math.min(date, d.getUTCDate()));
  return d.toISOString().slice(0, 10);
}
function expiresOn(profile: Profile) {
  if (profile.basis === "implied_purchase") return consentEnd(profile.consentAt, 24);
  if (profile.basis === "implied_inquiry") return consentEnd(profile.consentAt, 6);
  return null;
}

export function snapshot(at = new Date().toISOString(), ownHold?: string) {
  const state = loadState(at);
  const day = todayIso(new Date(at));
  const withdrawals = new Set(
    state.withdrawals.flatMap((w) => [w.customer && "id:" + w.customer, w.email, w.phone]).filter(Boolean)
  );
  const recent = state.sends.filter((e) => Date.parse(e.at) >= Date.parse(at) - CONTACT_COOLDOWN_DAYS * dayMs);
  const suppressed = new Set(recent.flatMap((e) => ["id:" + e.customer, e.destination]));
  const held = new Set(
    state.holds.filter((h) => h.id !== ownHold).flatMap((h) => ["id:" + h.customer, h.destination])
  );
  const future = new Set(
    state.bookings.filter((b) => b.status === "scheduled" && b.date >= day).map((b) => b.customerId)
  );
  const completed = new Map<string, typeof state.bookings>();
  for (const b of state.bookings) {
    if (b.status !== "completed" || b.date > day) continue;
    const visits = completed.get(b.customerId) ?? [];
    visits.push(b);
    completed.set(b.customerId, visits);
  }
  return state.profiles
    .flatMap(({ batch, value: p }) => {
      const visits = completed.get(p.id);
      if (!visits?.length) return [];
      const last = visits.reduce((a, b) => (a.date >= b.date ? a : b));
      const spend = visits.reduce((n, b) => n + b.cents, 0);
      const destination = p.channel === "email" ? p.email : p.phone;
      const validDestination =
        p.channel === "email"
          ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)
          : p.channel === "sms" && /^\+[1-9]\d{7,14}$/.test(destination);
      const idKey = "id:" + p.id;
      const optedOut = withdrawals.has(idKey) || withdrawals.has(destination);
      const expiry = expiresOn(p);
      const validBasis = p.basis === "express" || (expiry !== null && day < expiry);
      const consent =
        validBasis && Boolean(p.evidence && p.consentAt && p.consentAt <= at) && !optedOut && validDestination;
      const record: CustomerRecord = {
        id: p.id,
        fullName: p.name,
        email: p.email,
        phone: p.phone,
        businessType: "Med-spa",
        preferredChannel: p.channel,
        vip: p.vip,
        typicalReturnDays: p.cycle,
        totalSpendCents: spend,
        averageTicketCents: Math.round(spend / visits.length),
        marketingConsent: consent,
        notes: "",
        createdAt: "",
        lastVisitDate: last.date,
        lastServiceType: last.service,
        appointmentCount: visits.length
      };
      const customer = scoreCustomer(record, day);
      const overdue = customer.daysOverdue > 0 && !future.has(p.id);
      const recentlyContacted = suppressed.has(idKey) || suppressed.has(destination);
      const contactable = overdue && consent && !recentlyContacted && !held.has(idKey) && !held.has(destination);
      const proof = {
        profileBatch: batch,
        basis: p.basis,
        grantedAt: p.consentAt,
        evidence: p.evidence,
        channel: p.channel,
        destination,
        expiresOn: expiry,
        optedOut,
        checkedAt: at
      };
      return [{ customer, overdue, consent, recentlyContacted, contactable, proof }];
    })
    .sort(
      (a, b) =>
        b.customer.priorityScore - a.customer.priorityScore ||
        b.customer.estimatedRecoverableRevenueCents - a.customer.estimatedRecoverableRevenueCents ||
        a.customer.id.localeCompare(b.customer.id)
    );
}

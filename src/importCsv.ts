import { parse } from "csv-parse/sync";
import { z } from "zod";
import { todayIso } from "./utils.js";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
const smallText = z.string().trim().min(1).max(200);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + "T12:00:00Z");
    return Number.isFinite(+d) && d.toISOString().startsWith(s);
  }, "invalid calendar date");

export function timestamp(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !day.safeParse(value.slice(0, 10)).success ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error("Expected an ISO timestamp with timezone.");
  }
  return new Date(value).toISOString();
}

const number = z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative().safe());
const rowSchema = z.object({
  customer_id: id,
  full_name: smallText,
  preferred_channel: z.enum(["sms", "email", "phone"]),
  email: z.string().max(254).default(""),
  phone: z.string().max(40).default(""),
  typical_return_days: number.pipe(z.number().min(1).max(3650)),
  vip: z.enum(["true", "false", ""]).default(""),
  appointment_id: id,
  service_type: smallText,
  service_date: day,
  status: z.enum(["scheduled", "completed", "cancelled", "no_show"]),
  revenue_cents: number,
  booked_at: z.string().default(""),
  consent_basis: z.enum(["", "none", "express", "implied_purchase", "implied_inquiry"]).default(""),
  consent_at: z.string().default(""),
  consent_evidence: z.string().trim().max(1000).default(""),
  opted_out_at: z.string().default(""),
  client_id: z.string().optional()
});

export interface Profile {
  id: string;
  name: string;
  channel: "sms" | "email" | "phone";
  email: string;
  phone: string;
  cycle: number;
  vip: boolean;
  basis: string;
  consentAt: string;
  evidence: string;
}
export interface Booking {
  id: string;
  customerId: string;
  service: string;
  date: string;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  cents: number;
  bookedAt: string;
}

export function parseExport(csv: string, clientId: string, asOf: string, businessDay: string) {
  const parsed: Record<string, string>[] = parse(csv, {
    bom: true,
    trim: true,
    skip_empty_lines: true,
    columns(headers: string[]) {
      if (new Set(headers).size !== headers.length || headers.some((h) => !h))
        throw new Error("Duplicate or blank CSV header.");
      return headers;
    }
  });
  if (!parsed.length) throw new Error("Booking export has no data rows.");
  const profiles = new Map<string, Profile>();
  const bookings = new Map<string, Booking>();
  const withdrawals = new Map<string, Set<string>>();
  function remember<T>(index: Map<string, T>, key: string, value: T) {
    if (index.has(key) && JSON.stringify(index.get(key)) !== JSON.stringify(value))
      throw new Error("Conflicting duplicate ID.");
    index.set(key, value);
  }
  function past(value: string) {
    if (!value) return "";
    const at = timestamp(value);
    if (at > asOf) throw new Error("Event occurs after the export timestamp.");
    return at;
  }
  for (const [i, raw] of parsed.entries()) {
    try {
      const result = rowSchema.safeParse(raw);
      if (!result.success)
        throw new Error("Invalid " + result.error.issues.map((v) => v.path.join(".")).join(", "));
      const r = result.data;
      if (r.client_id !== undefined && r.client_id !== clientId) throw new Error("Client ID mismatch.");
      if (r.status === "completed" && r.service_date > businessDay)
        throw new Error("Future completed appointment.");
      const consentAt = past(r.consent_at);
      const basis = r.consent_basis || "none";
      if (basis !== "none" && (!consentAt || !r.consent_evidence))
        throw new Error("Missing consent date or evidence.");
      if (basis === "none" && (consentAt || r.consent_evidence))
        throw new Error("Consent details require a basis.");
      // Normalize addresses so suppression also works for duplicate customer IDs.
      const email = r.email.trim().toLowerCase();
      const digits = r.phone.replace(/[().\s-]/g, "");
      const phone = /^\d{10}$/.test(digits) ? "+1" + digits : /^1\d{10}$/.test(digits) ? "+" + digits : digits;
      remember(profiles, r.customer_id, {
        id: r.customer_id,
        name: r.full_name,
        channel: r.preferred_channel,
        email,
        phone,
        cycle: r.typical_return_days,
        vip: r.vip === "true",
        basis,
        consentAt,
        evidence: r.consent_evidence
      });
      const bookedAt = past(r.booked_at);
      if (bookedAt && todayIso(new Date(bookedAt)) > r.service_date)
        throw new Error("Booking created after the service date.");
      remember(bookings, r.appointment_id, {
        id: r.appointment_id,
        customerId: r.customer_id,
        service: r.service_type,
        date: r.service_date,
        status: r.status,
        cents: r.revenue_cents,
        bookedAt
      });
      if (r.opted_out_at) {
        const times = withdrawals.get(r.customer_id) ?? new Set();
        times.add(past(r.opted_out_at));
        withdrawals.set(r.customer_id, times);
      }
    } catch (error) {
      throw new Error(`CSV record ${i + 1}: ${(error as Error).message}`);
    }
  }
  return { profiles, bookings, withdrawals };
}

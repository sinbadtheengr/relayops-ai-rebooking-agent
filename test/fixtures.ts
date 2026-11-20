import {
  importBookings,
  approveDraft,
  createOutreachDraft,
  releaseMessage,
  confirmSent
} from "../src/relayops.js";
import { config } from "../src/config.js";

export const oldVisit = {
  customer_id: "c1",
  full_name: "Avery Example",
  preferred_channel: "email",
  email: "avery@example.test",
  phone: "",
  typical_return_days: "30",
  vip: "true",
  appointment_id: "a1",
  service_type: "Visit",
  service_date: "2024-01-02",
  status: "completed",
  revenue_cents: "12345",
  booked_at: "2023-12-29T12:00:00Z",
  consent_basis: "express",
  consent_at: "2024-01-02T15:00:00Z",
  consent_evidence: "Signed rebooking form E101",
  opted_out_at: ""
};
export type Row = typeof oldVisit;
export function csv(rows: Partial<Row>[]) {
  const cols = Object.keys(oldVisit) as (keyof Row)[];
  return [
    cols.join(","),
    ...rows.map((row) => cols.map((k) => '"' + { ...oldVisit, ...row }[k].replaceAll('"', '""') + '"').join(","))
  ].join("\r\n");
}
export function load(rows: Partial<Row>[] = [{}], at = "2025-01-01T00:00:00Z") {
  return importBookings(config.clientId, csv(rows), at);
}
export function four() {
  load(
    [1, 2, 3, 4].map((i) => ({ customer_id: "c" + i, appointment_id: "a" + i, email: `user${i}@example.test` }))
  );
}
export function sent(customer: string) {
  const d = createOutreachDraft(customer);
  approveDraft(d.id);
  releaseMessage(d.id);
  confirmSent(d.id);
  return d;
}

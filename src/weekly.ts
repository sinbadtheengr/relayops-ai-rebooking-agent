import { action, audit, countsBetween, loadState } from "./db.js";
import { snapshot } from "./eligibility.js";
import { config } from "./config.js";
import { formatCurrency, midnight, shiftDay, todayIso } from "./utils.js";

export function previousMonday(today = todayIso()) {
  return shiftDay(today, -((new Date(today).getUTCDay() + 6) % 7) - 7);
}

export function weeklyReport(startDay = previousMonday()) {
  return action("report.weekly", startDay, () => {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(startDay) ||
      new Date(startDay).getUTCDay() !== 1 ||
      new Date(startDay).toISOString().slice(0, 10) !== startDay ||
      startDay > todayIso()
    )
      throw new Error("Choose a current or past Monday (YYYY-MM-DD).");
    const nextMonday = shiftDay(startDay, 7);
    const start = midnight(startDay),
      end = midnight(nextMonday);
    const at = new Date(Math.min(Date.now(), Date.parse(end) - 1)).toISOString();
    const rows = snapshot(at);
    // Use the latest corrected CSV for financial outcomes. A late export can
    // restate a booking or realized revenue for its actual business week.
    const { bookings, sends } = loadState(new Date().toISOString());
    const byCustomer = new Map<string, number[]>();
    for (const send of sends) {
      const times = byCustomer.get(send.customer) ?? [];
      times.push(Date.parse(send.at));
      byCustomer.set(send.customer, times);
    }
    let bookingCount = 0,
      recoveredRevenueCents = 0;
    for (const b of bookings) {
      if (!b.bookedAt || !["scheduled", "completed"].includes(b.status)) continue;
      const booked = Date.parse(b.bookedAt);
      const attributable = byCustomer
        .get(b.customerId)
        ?.some((sent) => sent < booked && booked - sent <= 30 * 86_400_000);
      if (!attributable) continue;
      if (b.bookedAt >= start && b.bookedAt < end) bookingCount++;
      if (b.status === "completed" && b.date >= startDay && b.date < nextMonday) recoveredRevenueCents += b.cents;
    }
    const report = {
      client: config.clientId,
      weekStarting: startDay,
      weekEnding: shiftDay(nextMonday, -1),
      timezone: config.timezone,
      snapshotAt: at,
      overdueClients: rows.filter((r) => r.overdue).length,
      contactableClients: rows.filter((r) => r.contactable).length,
      ...countsBetween(start, end),
      bookings: bookingCount,
      recoveredRevenueCents
    };
    audit("report.generated", startDay, "ok", JSON.stringify(report));
    return report;
  });
}
export function weeklyText(r: ReturnType<typeof weeklyReport>) {
  return [
    `Weekly recovery · ${r.client} · ${r.weekStarting} through ${r.weekEnding} (${r.timezone})`,
    `Overdue clients: ${r.overdueClients}`,
    `Clients we can contact: ${r.contactableClients}`,
    `Drafts approved: ${r.draftsApproved}`,
    `Messages sent (staff-confirmed): ${r.messagesSent}`,
    `Replies: ${r.replies}`,
    `Attributed bookings: ${r.bookings}`,
    `Recovered revenue (CAD): ${formatCurrency(r.recoveredRevenueCents)}`
  ].join("\n");
}

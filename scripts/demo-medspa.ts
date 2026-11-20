import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock } from "node:test";

const samples = new URL("../examples/med-spa/", import.meta.url);
const runDir = mkdtempSync(join(tmpdir(), "relayops-medspa-"));
const tenant = "juniper-cove-sample";

// Config loads dotenv at import time. Give this run its own working directory
// and store before loading any pilot module, even on a configured staff machine.
process.chdir(runDir);
Object.assign(process.env, {
  RELAYOPS_CLIENT_ID: tenant,
  RELAYOPS_DATA_DIR: runDir,
  RELAYOPS_SENDER_NAME: "Juniper Cove Demo Med-Spa",
  RELAYOPS_MAILING_ADDRESS: "100 Example Lane, Toronto ON M5V 0A1",
  RELAYOPS_CONTACT_EMAIL: "desk@juniper.example.test",
  RELAYOPS_ENABLE_OPENAI: "false",
  SLACK_TEAM_ID: "",
  TIMEZONE: "America/Toronto"
});

const { createOutreachDraft, importBookings, messageRecord, auditTrail } = await import("../src/relayops.js");
const { staffCommand } = await import("../src/staff.js");
const { weeklyReport, weeklyText } = await import("../src/weekly.js");
const { closeDb } = await import("../src/db.js");

function at(iso: string) {
  mock.timers.setTime(Date.parse(iso));
}

function load(file: string, exportedAt: string) {
  at(exportedAt);
  const batch = importBookings(tenant, readFileSync(new URL(file, samples), "utf8"), exportedAt);
  console.log(`Imported ${file} (batch ${batch.batch}).`);
}

async function staff(command: string) {
  console.log(`\n/relayops ${command}`);
  const { text } = await staffCommand(command);
  console.log(text);
}

async function expectBlocked(command: string, reason: RegExp) {
  console.log(`\n/relayops ${command}`);
  await assert.rejects(() => staffCommand(command), (error: Error) => {
    assert.match(error.message, reason);
    console.log(`Blocked: ${error.message}`);
    return true;
  });
}

function review(customer: string) {
  console.log(`\n/relayops draft ${customer}`);
  const draft = createOutreachDraft(customer);
  const { message } = messageRecord(draft.id);
  console.log(`${draft.customer.fullName} · ${message.template}\nConsent: ${message.evidence.basis} · ${message.evidence.evidence}\n\n${draft.message}`);
  return draft.id;
}

console.log("Juniper Cove Demo Med-Spa · simulated staff confirmations and replies · all delivery is local");
console.log(`Demo records: ${runDir}\n`);
mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-02T13:50:00Z") });
try {
  load("01-opening.csv", "2026-11-02T13:50:00Z");
  const opening = weeklyReport("2026-11-02");
  console.log(`Opening scan: ${opening.overdueClients} overdue, ${opening.contactableClients} eligible for outreach.`);
  assert.deepEqual([opening.overdueClients, opening.contactableClients], [4, 3]);

  at("2026-11-02T14:02:00Z");
  const avery = review("C101");
  at("2026-11-02T14:03:00Z");
  await expectBlocked(`deliver ${avery}`, /approval is required/i);
  at("2026-11-02T14:04:00Z");
  await staff(`approve ${avery}`);
  at("2026-11-02T14:05:00Z");
  await staff(`deliver ${avery}`);
  at("2026-11-02T14:06:00Z");
  await staff(`sent ${avery}`);

  at("2026-11-02T14:07:00Z");
  const morgan = review("C102");
  at("2026-11-02T14:08:00Z");
  await staff(`approve ${morgan}`);
  at("2026-11-02T14:09:00Z");
  await staff(`deliver ${morgan}`);
  at("2026-11-02T14:10:00Z");
  await staff(`sent ${morgan}`);
  at("2026-11-02T14:31:00Z");
  await staff(`reply ${avery} reply desk-email-104 2026-11-02T14:30:00Z`);
  at("2026-11-02T14:36:00Z");
  await staff(`reply ${morgan} optout desk-sms-208 2026-11-02T14:35:00Z`);
  await expectBlocked("draft C104", /no longer eligible/i);

  load("02-booked.csv", "2026-11-02T15:30:00Z");
  const scheduled = weeklyReport("2026-11-02");
  console.log(weeklyText(scheduled));
  assert.deepEqual([scheduled.bookings, scheduled.recoveredRevenueCents], [1, 0]);
  load("03-completed.csv", "2026-11-06T22:00:00Z");

  at("2026-11-09T13:00:00Z");
  const week = weeklyReport();
  assert.equal(week.weekStarting, "2026-11-02");
  assert.deepEqual(
    [week.overdueClients, week.contactableClients, week.draftsApproved, week.messagesSent, week.replies, week.bookings, week.recoveredRevenueCents],
    [3, 1, 2, 2, 2, 1, 18500]
  );

  at("2026-11-20T15:00:00Z");
  console.log("\nChecking Morgan after both CSV updates and the 14-day cooldown.");
  await expectBlocked("draft C102", /no longer eligible/i);
  for (const [name, id] of [["avery", avery], ["morgan", morgan]]) {
    const record = messageRecord(id);
    assert.deepEqual(record.events.map(event => event.kind), ["approved", "released", "sent"]);
    assert.equal(record.withdrawals.length, name === "morgan" ? 1 : 0);
    writeFileSync(join(runDir, name + "-message.json"), JSON.stringify(record, null, 2) + "\n");
  }
  const report = weeklyText(week);
  writeFileSync(join(runDir, "weekly-recovery.txt"), report + "\n");
  writeFileSync(join(runDir, "audit-log.json"), JSON.stringify(auditTrail(), null, 2) + "\n");
  console.log(`\n${report}\n\nMessage records, audit log and report: ${runDir}`);
} finally {
  closeDb();
  mock.timers.reset();
}

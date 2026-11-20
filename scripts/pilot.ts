import { readFileSync } from "node:fs";
import { audit, auditTrail, importBookings, messageRecord } from "../src/relayops.js";
import { weeklyReport, weeklyText } from "../src/weekly.js";
import { staffCommand } from "../src/staff.js";

const [command, ...args] = process.argv.slice(2);
try {
  if (command === "import") {
    const [client, file, asOf] = args;
    if (args.length !== 3) throw new Error("Usage: npm run import:csv -- CLIENT_ID FILE EXPORTED_AT");
    let csv: string;
    try {
      csv = readFileSync(file, "utf8");
    } catch {
      audit("csv.open", "", "failed");
      throw new Error("Cannot read booking export file.");
    }
    console.log(JSON.stringify(importBookings(client, csv, asOf)));
  } else if (command === "weekly") {
    console.log(weeklyText(weeklyReport(args[0])));
  } else if (command === "audit") {
    console.log(JSON.stringify(auditTrail(), null, 2));
  } else if (command === "record") {
    console.log(JSON.stringify(messageRecord(args[0] ?? ""), null, 2));
  } else if (["draft", "approve", "deliver", "sent", "cancel", "optout", "reply"].includes(command)) {
    const result = await staffCommand([command, ...args].join(" "));
    console.log(result.text);
  } else
    throw new Error(
      "Choose import, weekly, audit, record, draft, approve, deliver, sent, cancel, optout or reply."
    );
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}

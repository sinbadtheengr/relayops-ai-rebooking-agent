import { seedDemoData } from "../src/demoData.js";
import { listCustomerRecords } from "../src/db.js";
import { formatDailySummaryText } from "../src/agent.js";

if (listCustomerRecords().length === 0) {
  seedDemoData();
}

console.log(formatDailySummaryText());


import { seedDemoData } from "../src/demoData.js";
import { listCustomerRecords } from "../src/db.js";

seedDemoData();

console.log(`Seeded ${listCustomerRecords().length} customers with appointment history.`);


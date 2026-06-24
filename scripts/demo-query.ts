import { seedDemoData } from "../src/demoData.js";
import { listCustomerRecords } from "../src/db.js";
import { answerBusinessQuestion } from "../src/agent.js";

const question = process.argv.slice(2).join(" ") || "Which customers should we contact today?";

if (listCustomerRecords().length === 0) {
  seedDemoData();
}

console.log(await answerBusinessQuestion(question));


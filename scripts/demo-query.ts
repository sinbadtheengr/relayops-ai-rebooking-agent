import { answerBusinessQuestion } from "../src/agent.js";
import { audit } from "../src/relayops.js";
const question = process.argv.slice(2).join(" ") || "Which customers should we contact today?";
audit("question");
console.log(await answerBusinessQuestion(question));

import { beforeAll, describe, expect, it } from "vitest";
import { seedDemoData } from "../src/demoData.js";
import { answerBusinessQuestion } from "../src/agent.js";

// With OPENAI_API_KEY unset (see test/setup.ts), answerBusinessQuestion routes
// through the deterministic parser — this exercises parseDeterministicIntent.
beforeAll(() => {
  seedDemoData();
});

describe("deterministic agent routing", () => {
  it("routes summary questions to the daily summary", async () => {
    const answer = await answerBusinessQuestion("Summarize today's opportunities");
    expect(answer).toContain("RelayOps Daily Rebooking Scan");
  });

  it("routes draft questions to an outreach draft", async () => {
    const answer = await answerBusinessQuestion("Draft a follow-up message");
    expect(answer.toLowerCase()).toContain("draft for");
  });

  it("filters to VIP customers", async () => {
    const answer = await answerBusinessQuestion("Show overdue VIP customers");
    expect(answer).toContain("Customers to contact");
  });

  it("never returns an empty string", async () => {
    const answer = await answerBusinessQuestion("gibberish that matches nothing in particular");
    expect(answer.length).toBeGreaterThan(0);
  });
});

import cron from "node-cron";
import type { App } from "@slack/bolt";
import { asActor } from "./actor.js";
import { config } from "./config.js";
import { audit, getDailySummary } from "./relayops.js";
import { weeklyReport, weeklyText } from "./weekly.js";

export function scheduleReports(app: App) {
  function schedule(expression: string, action: string, generate: () => string) {
    cron.schedule(
      expression,
      () =>
        asActor("system:scheduler", async () => {
          try {
            const text = generate();
            if (config.slackReportChannelId) {
              await app.client.chat.postMessage({ channel: config.slackReportChannelId, text });
              audit(action + ".posted", config.slackReportChannelId);
            }
          } catch (error) {
            audit(action, "", "failed", (error as Error).message);
            console.error(action + " failed:", error);
          }
        }),
      { timezone: config.timezone }
    );
  }
  schedule("0 8 * * 1", "weekly", () => weeklyText(weeklyReport()));
  if (config.dailyScanEnabled && config.slackReportChannelId)
    schedule(config.dailyScanCron, "daily", () => {
      const s = getDailySummary();
      return `Daily scan: ${s.overdueCustomerCount} overdue clients. Run /relayops scan for your private review list.`;
    });
}

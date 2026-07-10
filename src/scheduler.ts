import cron from "node-cron";
import type { App } from "@slack/bolt";
import { config } from "./config.js";
import { getDailySummary } from "./relayops.js";
import { dailySummaryBlocks } from "./slackBlocks.js";
import { formatDailySummaryText } from "./agent.js";

export function scheduleDailyScan(app: App): void {
  if (!config.dailyScanEnabled || !config.slackReportChannelId) return;

  cron.schedule(
    config.dailyScanCron,
    async () => {
      try {
        await app.client.chat.postMessage({
          channel: config.slackReportChannelId!,
          text: formatDailySummaryText(),
          blocks: dailySummaryBlocks(getDailySummary())
        });
      } catch (error) {
        // Never rethrow: a single failed post (revoked token, archived channel,
        // transient network) must not kill the process. The next run still fires.
        console.error("Daily scan failed to post to Slack:", error);
      }
    },
    { timezone: config.timezone }
  );
}


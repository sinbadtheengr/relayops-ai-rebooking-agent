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
      await app.client.chat.postMessage({
        channel: config.slackReportChannelId!,
        text: formatDailySummaryText(),
        blocks: dailySummaryBlocks(getDailySummary())
      });
    },
    { timezone: config.timezone }
  );
}


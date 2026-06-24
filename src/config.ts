import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const ConfigSchema = z.object({
  databaseUrl: z.string().default("./data/relayops.db"),
  slackBotToken: z.string().optional(),
  slackAppToken: z.string().optional(),
  slackSigningSecret: z.string().optional(),
  slackReportChannelId: z.string().optional(),
  dailyScanEnabled: z.boolean().default(false),
  dailyScanCron: z.string().default("0 8 * * 1-6"),
  timezone: z.string().default("America/Toronto"),
  openAiApiKey: z.string().optional(),
  openAiModel: z.string().default("gpt-4o-mini"),
  publicAppUrl: z.string().default("https://example.ngrok-free.app")
});

export const config = ConfigSchema.parse({
  databaseUrl: process.env.DATABASE_URL ?? "./data/relayops.db",
  slackBotToken: process.env.SLACK_BOT_TOKEN,
  slackAppToken: process.env.SLACK_APP_TOKEN,
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
  slackReportChannelId: process.env.SLACK_REPORT_CHANNEL_ID,
  dailyScanEnabled: process.env.DAILY_SCAN_ENABLED === "true",
  dailyScanCron: process.env.DAILY_SCAN_CRON ?? "0 8 * * 1-6",
  timezone: process.env.TIMEZONE ?? "America/Toronto",
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  publicAppUrl: process.env.PUBLIC_APP_URL ?? "https://example.ngrok-free.app"
});


import dotenv from "dotenv";
dotenv.config();

export const config = {
  clientId: process.env.RELAYOPS_CLIENT_ID ?? "",
  dataDir: process.env.RELAYOPS_DATA_DIR ?? "./data/pilot",
  teamId: process.env.SLACK_TEAM_ID ?? "",
  staff: (process.env.RELAYOPS_STAFF_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  senderName: process.env.RELAYOPS_SENDER_NAME?.trim() ?? "",
  mailingAddress: process.env.RELAYOPS_MAILING_ADDRESS?.trim() ?? "",
  contactEmail: process.env.RELAYOPS_CONTACT_EMAIL?.trim() ?? "",
  slackBotToken: process.env.SLACK_BOT_TOKEN,
  slackAppToken: process.env.SLACK_APP_TOKEN,
  slackSigningSecret: process.env.SLACK_SIGNING_SECRET,
  slackReportChannelId: process.env.SLACK_REPORT_CHANNEL_ID,
  dailyScanEnabled: process.env.DAILY_SCAN_ENABLED === "true",
  dailyScanCron: process.env.DAILY_SCAN_CRON ?? "0 8 * * 1-6",
  timezone: process.env.TIMEZONE ?? "America/Toronto",
  openAiApiKey: process.env.RELAYOPS_ENABLE_OPENAI === "true" ? process.env.OPENAI_API_KEY : undefined,
  openAiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini"
};

export function senderIdentity() {
  const { senderName, mailingAddress, contactEmail } = config;
  if (
    !senderName ||
    senderName.length > 150 ||
    !mailingAddress ||
    mailingAddress.length > 300 ||
    contactEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)
  ) {
    throw new Error(
      "Configure the spa's sender name, mailing address and monitored contact email before outreach."
    );
  }
  return { senderName, mailingAddress, contactEmail };
}

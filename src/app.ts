import { App, LogLevel } from "@slack/bolt";
import { config } from "./config.js";
import { seedDemoData } from "./demoData.js";
import { listCustomerRecords } from "./db.js";
import { answerBusinessQuestion } from "./agent.js";
import { CONTACT_COOLDOWN_DAYS, createOutreachDraft, markCustomerContacted } from "./relayops.js";
import { getDailySummary } from "./relayops.js";
import { dailySummaryBlocks, homeDashboardBlocks, outreachDraftBlocks } from "./slackBlocks.js";
import { scheduleDailyScan } from "./scheduler.js";

/** Best-effort ephemeral notice when an action targets a customer that no longer exists (e.g. stale button after a re-seed). */
async function notifyStale(respond: (message: any) => Promise<unknown>): Promise<void> {
  try {
    await respond({
      response_type: "ephemeral",
      text: "Sorry — I couldn't find that customer anymore. Run `/relayops scan` for a fresh report."
    });
  } catch {
    // A failed respond must not rethrow out of the action handler.
  }
}

if (!config.slackBotToken || !config.slackAppToken || !config.slackSigningSecret) {
  throw new Error(
    "Missing Slack credentials. Copy .env.example to .env and set SLACK_BOT_TOKEN, SLACK_APP_TOKEN, and SLACK_SIGNING_SECRET."
  );
}

if (listCustomerRecords().length === 0) {
  seedDemoData();
}

const app = new App({
  token: config.slackBotToken,
  appToken: config.slackAppToken,
  signingSecret: config.slackSigningSecret,
  socketMode: true,
  logLevel: LogLevel.INFO
});

async function respondToPrompt(args: {
  text: string;
  say?: (message: { text: string; thread_ts?: string }) => Promise<unknown>;
  respond?: (message: { text: string; thread_ts?: string }) => Promise<unknown>;
  threadTs?: string;
  sayStream?: () => { append: (chunk: { markdown_text: string }) => Promise<void>; stop: () => Promise<void> };
}): Promise<void> {
  const responseText = await answerBusinessQuestion(args.text);

  if (args.sayStream) {
    const stream = args.sayStream();
    await stream.append({ markdown_text: responseText });
    await stream.stop();
    return;
  }

  const payload = { text: responseText, thread_ts: args.threadTs };
  if (args.respond) {
    await args.respond(payload);
  } else if (args.say) {
    await args.say(payload);
  }
}

app.command("/relayops", async ({ command, ack, respond }) => {
  await ack();
  const text = command.text?.trim();

  if (!text || text === "scan") {
    await respond({
      response_type: "in_channel",
      text: "RelayOps Daily Rebooking Scan",
      blocks: dailySummaryBlocks(getDailySummary())
    } as never);
    return;
  }

  await respondToPrompt({ text, respond });
});

app.event("app_mention", async ({ event, say, client, sayStream, setStatus }) => {
  const text = ((event as { text?: string }).text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim();
  const threadTs = (event as { thread_ts?: string; ts?: string }).thread_ts ?? (event as { ts?: string }).ts;

  if ((event as { channel?: string; ts?: string }).channel && (event as { ts?: string }).ts) {
    try {
      await client.reactions.add({
        channel: (event as { channel: string }).channel,
        timestamp: (event as { ts: string }).ts,
        name: "eyes"
      });
    } catch {
      // Decoration only. Slack redelivers events on slow acks (already_reacted),
      // and some surfaces disallow reactions — never let this abort the answer.
    }
  }

  try {
    await setStatus?.({
      status: "Checking CRM and booking records...",
      loading_messages: ["Scoring overdue customers", "Calculating recovery value", "Drafting the next best action"]
    });
  } catch {
    // Status is decoration; the answer below is the job.
  }

  await respondToPrompt({
    text: text || "Summarize today's opportunities",
    say: say as (message: { text: string; thread_ts?: string }) => Promise<unknown>,
    threadTs,
    sayStream: sayStream as unknown as () => { append: (chunk: { markdown_text: string }) => Promise<void>; stop: () => Promise<void> }
  });
});

app.message(async ({ message, say }) => {
  const payload = message as {
    text?: string;
    channel_type?: string;
    bot_id?: string;
    app_id?: string;
    subtype?: string;
    user?: string;
  };
  if (payload.channel_type !== "im" || payload.bot_id || payload.app_id || payload.subtype || !payload.user) return;

  await respondToPrompt({
    text: payload.text?.trim() || "Which customers should we contact today?",
    say: say as (message: { text: string; thread_ts?: string }) => Promise<unknown>
  });
});

app.event("assistant_thread_started" as never, async ({ client, event, logger }: any) => {
  const assistantThread = (event as { assistant_thread?: { channel_id: string; thread_ts: string } }).assistant_thread;
  if (!assistantThread) return;

  try {
    await client.assistant.threads.setSuggestedPrompts({
      channel_id: assistantThread.channel_id,
      thread_ts: assistantThread.thread_ts,
      title: "Try asking RelayOps",
      prompts: [
        { title: "Today's contacts", message: "Which customers should we contact today?" },
        { title: "90-day gap", message: "Who has not returned in 90 days?" },
        { title: "VIP follow-up", message: "Show overdue VIP customers" },
        { title: "Revenue summary", message: "Summarize today's opportunities" }
      ]
    });
  } catch (error) {
    logger.error(error);
  }
});

async function publishHome(client: any, userId: string): Promise<void> {
  await client.views.publish({
    user_id: userId,
    view: { type: "home", blocks: homeDashboardBlocks(getDailySummary()) }
  });
}

app.event("app_home_opened", async ({ event, client, logger }) => {
  try {
    await publishHome(client, (event as { user: string }).user);
  } catch (error) {
    logger.error(error);
  }
});

app.action("refresh_home", async ({ ack, body, client, logger }) => {
  await ack();
  try {
    await publishHome(client, (body as { user: { id: string } }).user.id);
  } catch (error) {
    logger.error(error);
  }
});

app.action("draft_customer", async ({ ack, body, respond, logger }) => {
  await ack();
  const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
  if (!action?.value) return;

  try {
    const draft = createOutreachDraft(action.value);
    await respond({
      response_type: "ephemeral",
      text: "RelayOps outreach draft",
      blocks: outreachDraftBlocks(draft)
    } as never);
  } catch (error) {
    logger.error(error);
    await notifyStale(respond);
  }
});

app.action("mark_contacted", async ({ ack, body, respond, logger }) => {
  await ack();
  const action = (body as { actions?: Array<{ value?: string }> }).actions?.[0];
  if (!action?.value) return;

  try {
    const actingUser = (body as { user?: { id?: string } }).user?.id;
    const note = actingUser ? `Marked contacted from Slack by <@${actingUser}>` : "Marked contacted from Slack";
    const customer = markCustomerContacted(action.value, note);
    await respond({
      response_type: "ephemeral",
      text: `${customer.fullName} was marked as contacted and will drop out of scans for the next ${CONTACT_COOLDOWN_DAYS} days.`
    } as never);
  } catch (error) {
    logger.error(error);
    await notifyStale(respond);
  }
});

scheduleDailyScan(app);

console.log("Starting RelayOps AI Rebooking Agent in Slack socket mode...");
await app.start();
console.log("RelayOps AI Rebooking Agent is running in Slack socket mode.");

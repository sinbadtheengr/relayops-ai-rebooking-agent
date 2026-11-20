import { App, LogLevel } from "@slack/bolt";
import { asActor } from "./actor.js";
import { config, senderIdentity } from "./config.js";
import { audit, getDailySummary } from "./relayops.js";
import { homeDashboardBlocks } from "./slackBlocks.js";
import { authorized, staffCommand } from "./staff.js";
import { scheduleReports } from "./scheduler.js";

if (
  !config.slackBotToken ||
  !config.slackAppToken ||
  !config.slackSigningSecret ||
  !config.teamId ||
  !config.staff.length
) {
  throw new Error("Configure Slack credentials, SLACK_TEAM_ID and RELAYOPS_STAFF_IDS before starting Slack.");
}
senderIdentity();
const app = new App({
  token: config.slackBotToken,
  appToken: config.slackAppToken,
  signingSecret: config.slackSigningSecret,
  socketMode: true,
  logLevel: LogLevel.INFO
});

// Authenticate the workspace before opening its store or running a scheduled job.
const auth = await app.client.auth.test();
if (auth.team_id !== config.teamId) throw new Error("Slack bot belongs to a different workspace.");

asActor("system:slack", () => audit("app.start", auth.team_id));
const denied = { text: "Access is restricted to this pilot's staff." };
async function handle(team: unknown, user: string, input: string) {
  return asActor("slack:" + user, async () => {
    if (!authorized(team, user)) {
      audit("slack.access", "", "denied");
      return denied;
    }
    try {
      return await staffCommand(input);
    } catch (error) {
      audit("slack.command", "", "failed", (error as Error).message);
      return { text: (error as Error).message };
    }
  });
}

app.command("/relayops", async ({ command, ack, respond }) => {
  await ack();
  await respond({ response_type: "ephemeral", ...(await handle(command.team_id, command.user_id, command.text)) });
});

app.event("app_mention", async ({ event, body, client }) => {
  if (!event.user) return;
  const result = await handle(body.team_id, event.user, event.text.replace(/<@[A-Z0-9]+>/g, "").trim());
  await client.chat.postEphemeral({ channel: event.channel, user: event.user, ...result });
});

app.message(async ({ message, body, say }) => {
  if (
    message.channel_type !== "im" ||
    "bot_id" in message ||
    "app_id" in message ||
    message.subtype ||
    !("user" in message)
  )
    return;
  await say(await handle(body.team_id, message.user, message.text ?? ""));
});

app.event("assistant_thread_started", async ({ event, body, client }) => {
  const thread = event.assistant_thread;
  await asActor("slack:" + thread.user_id, async () => {
    if (!authorized(body.team_id, thread.user_id)) {
      audit("assistant.open", "", "denied");
      return;
    }
    await client.assistant.threads.setSuggestedPrompts({
      channel_id: thread.channel_id,
      thread_ts: thread.thread_ts,
      title: "Rebooking desk",
      prompts: [
        { title: "Today's contacts", message: "Which customers should we contact today?" },
        { title: "Weekly recovery", message: "weekly" }
      ]
    });
    audit("assistant.open");
  });
});

app.event("app_home_opened", async ({ event, body, client }) => {
  await asActor("slack:" + event.user, async () => {
    const ok = authorized(body.team_id, event.user);
    audit("home.open", "", ok ? "ok" : "denied");
    await client.views.publish({
      user_id: event.user,
      view: {
        type: "home",
        blocks: ok
          ? homeDashboardBlocks(getDailySummary(), config.clientId)
          : [{ type: "section", text: { type: "plain_text", text: denied.text } }]
      }
    });
  });
});

app.action(
  /^(draft_customer|approve_message|refresh_home|mark_contacted)$/,
  async ({ ack, body, respond, client, action }) => {
    await ack();
    if (action.type !== "button" || !("action_id" in action)) return;
    const user = body.user.id,
      team = body.team?.id;
    const result = await asActor("slack:" + user, async () => {
      if (!authorized(team, user)) {
        audit("slack.action", "", "denied");
        return denied;
      }
      if (action.action_id === "refresh_home") {
        await client.views.publish({
          user_id: user,
          view: { type: "home", blocks: homeDashboardBlocks(getDailySummary(), config.clientId) }
        });
        audit("home.refresh");
        return;
      }
      if (action.action_id === "mark_contacted") {
        audit("legacy.mark_contacted", "", "denied");
        return { text: "Run /relayops scan and approve a draft before delivery." };
      }
      const [clientId, subject] = (action.value ?? "").split("/");
      if (clientId !== config.clientId || !subject) {
        audit("slack.stale_button", "", "denied");
        return { text: "Run /relayops scan for the current pilot." };
      }
      return handle(team, user, `${action.action_id === "draft_customer" ? "draft" : "approve"} ${subject}`);
    });
    if (!result) return;
    if ("response_url" in body && body.response_url)
      await respond({ response_type: "ephemeral", replace_original: false, ...result });
    else await client.chat.postMessage({ channel: user, ...result });
  }
);

await app.start();
asActor("system:scheduler", () => scheduleReports(app));
console.log("RelayOps pilot is running in Slack socket mode.");

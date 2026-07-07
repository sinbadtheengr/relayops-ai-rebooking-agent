# RelayOps AI Rebooking Agent

RelayOps is a Slack-native AI employee for small businesses that lose revenue when customers do not return after their last appointment.

Every morning, RelayOps scans CRM and booking data, finds overdue customers, prioritizes the best recovery opportunities, drafts personalized outreach, and lets staff log follow-up work directly in Slack.

## Why It Matters

Small businesses already paid to acquire these customers. The missing workflow is repeat-booking recovery:

- Who is overdue?
- Who is worth contacting first?
- What should staff say?
- How much revenue could be recovered?

RelayOps answers those questions inside the tool staff already use.

## MVP Features

- Slack app using Bolt for JavaScript and agent-oriented Slack surfaces
- `/relayops scan` daily rebooking report
- App mention and DM natural-language questions
- Suggested Assistant prompts for common workflows
- 100-customer demo CRM and appointment dataset
- Priority scoring by overdue gap, spend, loyalty, VIP status, and consent
- AI function calling with OpenAI for grounded responses
- Deterministic fallback when `OPENAI_API_KEY` is not configured
- Personalized SMS, email, and phone outreach drafts
- Slack buttons for draft outreach and mark contacted
- SQLite storage with a clean PostgreSQL upgrade path
- Daily cron scheduling for morning reports

## Example Slack Questions

- Which customers should we contact today?
- Who has not returned in 90 days?
- Show overdue VIP customers
- Draft a follow-up message
- Summarize today's opportunities

## Tech Stack

- TypeScript
- Node.js
- Slack Bolt for JavaScript
- OpenAI GPT tool calling
- SQLite via `better-sqlite3`
- `node-cron` for scheduled scans

## Slack Builder Challenge Hackathon Alignment

RelayOps is now built for the **Slack Builder Challenge Hackathon** as a Slack-native agent experience, and is no longer positioned for the UiPath Challenge. The core product lives where staff already work: Slack channels, Slack DMs, slash commands, app mentions, Block Kit actions, and human-in-the-loop review.

Challenge fit:

- **New Slack agent**: RelayOps acts as an AI employee for rebooking and revenue recovery.
- **Slack-first UX**: staff can use `/relayops scan`, DM the app, mention it in a channel, and click action buttons.
- **Agentic workflow**: the agent retrieves structured customer data, scores opportunities, recommends next actions, and drafts outreach.
- **Human-in-the-loop control**: RelayOps drafts messages for staff review instead of sending customer outreach automatically.
- **Business impact**: the demo turns overlooked customer follow-up into a measurable daily revenue workflow.

Slack capabilities used:

- Slack app manifest
- Slack Bolt for JavaScript
- Socket Mode for local demo delivery
- Slash command: `/relayops`
- App mention handling
- App Home / DM message handling
- Block Kit reports and action buttons
- Ephemeral staff-only draft responses
- Suggested assistant prompts for common rebooking questions

## Coding Agent Usage

This project was built with Codex as an AI-assisted coding agent. Codex helped scaffold the TypeScript Slack app, generate the SQLite demo dataset, implement scoring and fallback logic, create documentation, produce the pitch deck, and debug the Slack interaction flow. The generated code is meaningfully integrated into the working MVP rather than referenced only as documentation.

## Judging Criteria Coverage

- **Real business value**: estimates recoverable revenue from customers who are overdue for rebooking.
- **Practical AI usage**: uses structured tools and scoring logic instead of generic chatbot responses.
- **Slack experience**: works in channels, DMs, slash commands, app mentions, and Block Kit actions.
- **Production readiness**: includes SQLite storage, clear PostgreSQL upgrade path, consent-aware channel recommendations, deterministic fallback, and setup docs.
- **Demo readiness**: includes mock data, local scripts, Slack app manifest, pitch deck, demo script, and video script.

## Quick Start

```bash
npm install
cp .env.example .env
npm run seed
npm run scan
```

`npm run scan` works without Slack or OpenAI credentials and prints the daily recovery report.

Ask a local demo question:

```bash
npm run demo:ask -- "Show overdue VIP customers"
```

## Slack Setup

1. Create a Slack app from `manifest.json`.
2. Enable Socket Mode.
3. Create an app-level token with `connections:write`.
4. Install the app to your workspace.
5. Copy credentials into `.env`:

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_SIGNING_SECRET=...
```

6. Start the app:

```bash
npm run dev
```

7. Invite RelayOps to a channel or DM the app.
8. Run `/relayops scan`.

For a public HTTP install flow, expose the app through ngrok and replace the placeholder URLs in `manifest.json`. Socket Mode is enabled for the MVP so local development does not require a public request URL for event delivery.

## OpenAI Setup

OpenAI is optional for local demos. Without `OPENAI_API_KEY`, RelayOps uses deterministic templates over the same scored data.

To enable GPT function calling:

```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

The agent is instructed to call tools for all customer facts. It should not invent customers or revenue estimates.

## Daily Scan

Enable scheduled Slack reports:

```bash
DAILY_SCAN_ENABLED=true
SLACK_REPORT_CHANNEL_ID=C0123456789
DAILY_SCAN_CRON=0 8 * * 1-6
TIMEZONE=America/Toronto
```

## Project Structure

```text
src/
  app.ts            Slack app runtime
  agent.ts          AI tool-calling and deterministic fallback
  db.ts             SQLite schema and repository functions
  demoData.ts       100-customer dataset generator
  outreach.ts       Personalized outreach drafts
  relayops.ts       Product-domain service layer
  scheduler.ts      Daily Slack report cron
  scoring.ts        Rebooking priority model
  slackBlocks.ts    Slack Block Kit views
docs/
  architecture.md
  demo-script.md
  pitch-deck-outline.md
  video-script.md
```

## Production Readiness Notes

- Replace `src/db.ts` with a PostgreSQL repository and keep the service interfaces intact.
- Add tenant isolation before connecting multiple businesses.
- Add booking connectors for Square, Fresha, Mindbody, Jane, Jobber, ServiceTitan, and CSV imports.
- Add consent and opt-out enforcement per channel.
- Add audit logs around AI drafts, staff actions, and customer outreach.
- Add RAG over customer notes, staff playbooks, service policies, and campaign history.

## Hackathon Deliverables

- Working Slack app: `src/app.ts`, `manifest.json`
- Agent architecture diagram: `docs/architecture.md`
- README and setup instructions: this file
- Demo script: `docs/demo-script.md`
- Pitch deck outline: `docs/pitch-deck-outline.md`
- 2-minute demo video script: `docs/video-script.md`

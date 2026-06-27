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

## UiPath AgentHack Alignment

RelayOps is submitted for **Track 2: UiPath Maestro BPMN** because the core workflow is a repeatable business process: scan customer records, score rebooking opportunities, route staff actions, log outcomes, and repeat.

Current working MVP:

- External coded Slack agent built with TypeScript, Node.js, and Slack Bolt
- SQLite-backed CRM and appointment data simulation
- OpenAI-compatible function calling with deterministic fallback
- Slack human-in-the-loop actions for draft review and contact logging

UiPath component target:

- **UiPath Maestro BPMN** should orchestrate the end-to-end process in UiPath Automation Cloud.
- The RelayOps Slack agent can be treated as an external coded agent/API participant in that process.
- Human review and staff follow-up steps map naturally to Maestro human tasks.
- Booking/CRM import, scoring, Slack notification, and contact logging can be modeled as BPMN service tasks and decision gateways.

Agent type:

- **Coded agent**: the current MVP is a coded external Slack agent.
- **Low-code orchestration target**: the intended UiPath layer is Maestro BPMN in Automation Cloud.

Important submission note: the repository demonstrates the functioning coded agent and BPMN-ready architecture. For full challenge compliance, the final submission should also include a UiPath Automation Cloud / Maestro environment URL or exported Maestro BPMN process showing UiPath as the orchestration layer.

## Coding Agent Usage

This project was built with Codex as an AI-assisted coding agent. Codex helped scaffold the TypeScript Slack app, generate the SQLite demo dataset, implement scoring and fallback logic, create documentation, produce the pitch deck, and debug the Slack interaction flow. The generated code is meaningfully integrated into the working MVP rather than referenced only as documentation.

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

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
- **MCP server** exposing the same rebooking intelligence to any MCP client (Claude Desktop, IDEs) — runs credential-free
- **App Home dashboard** with live KPIs (recoverable revenue, overdue count, high-priority, suppressed) and action buttons
- `/relayops scan` daily rebooking report
- App mention and DM natural-language questions
- Suggested Assistant prompts, streaming responses, and thinking status (Slack AI-app surface)
- 100-customer demo CRM and appointment dataset
- Priority scoring by overdue gap, spend, loyalty, VIP status, and consent
- **Closed follow-up loop**: customers marked contacted are suppressed from scans for a 14-day cooldown
- AI function calling with OpenAI for grounded responses
- Deterministic fallback when `OPENAI_API_KEY` is not configured
- Personalized SMS, email, and phone outreach drafts
- Slack buttons for draft outreach and mark contacted
- SQLite storage with a clean PostgreSQL upgrade path
- Daily cron scheduling for morning reports
- Automated test suite (`npm test`, Vitest) over scoring, filters, contact suppression, and the deterministic parser

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

## Slack Agent Builder Challenge Alignment

**Track:** New Slack Agent.

**Required technology (the challenge asks for at least one of three):**

- ✅ **MCP server integration** — `src/mcp/server.ts` exposes RelayOps as five MCP tools over stdio (`@modelcontextprotocol/sdk`). The same domain service layer that powers the Slack app also powers the MCP server, so any MCP client gets identical, data-grounded answers. Runs with no OpenAI key.
- ✅ **Slack AI capabilities** — Slack Agents & AI-Apps surface: assistant threads with suggested prompts, streaming markdown responses, and thinking-status updates.

RelayOps is built for the **Slack Agent Builder Challenge** as a Slack-native agent experience. The core product lives where staff already work: Slack channels, DMs, slash commands, app mentions, the App Home tab, Block Kit actions, and human-in-the-loop review.

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

Mapped to the four official criteria:

- **Technological Implementation** — satisfies the required tech via an MCP server (and the Slack AI-app surface); clean layered architecture (adapters → agent → service → pure domain → single SQL module); AI is grounded in structured tools with a deterministic fallback; a Vitest suite (`npm test`) covers scoring, filters, contact suppression, and the parser.
- **Design** — three Slack surfaces (slash command, App Home dashboard, conversational DM/mention) with Block Kit reports, KPI fields, and action buttons; a real frontend/backend blend, not a chat-only bot.
- **Potential Impact** — every appointment-based SMB (salons, dental, physio, home services) loses revenue to un-rebooked customers; RelayOps quantifies and recovers it. The MCP server extends that intelligence beyond Slack to any AI client.
- **Quality of the Idea** — not another generic chatbot: a grounded, human-in-the-loop revenue-recovery agent where every number traces to the database and the follow-up loop actually closes (contacted customers stop reappearing).

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

## MCP Server (Model Context Protocol)

RelayOps runs as an MCP server so any MCP client can query the same rebooking intelligence the Slack app uses. It needs **no Slack or OpenAI credentials** — it seeds the local demo data on first run.

Run it directly:

```bash
npm run mcp
```

Connect it to **Claude Desktop** — add this to `claude_desktop_config.json` (replace the path with your checkout):

```jsonc
{
  "mcpServers": {
    "relayops": {
      "command": "npx",
      "args": ["tsx", "scripts/mcp.ts"],
      "cwd": "/absolute/path/to/relayops-ai-rebooking-agent"
    }
  }
}
```

Then ask Claude things like *"Summarize today's RelayOps rebooking opportunities"* or *"Draft a follow-up for the most overdue VIP."*

Tools exposed (all read-only except an internal contact log — RelayOps never messages customers):

| Tool | Purpose |
|---|---|
| `get_rebooking_opportunities` | Ranked overdue customers, filterable by priority/VIP/service/days |
| `summarize_today` | Daily recoverable-revenue snapshot |
| `draft_follow_up` | Personalized outreach draft for staff review (by id or name) |
| `list_recently_contacted` | Customers currently suppressed by the cooldown |
| `mark_contacted` | Log staff contact (internal only), suppressing the customer from scans |

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
  app.ts            Slack app runtime (slash command, DM, mention, App Home, actions)
  agent.ts          AI tool-calling and deterministic fallback
  db.ts             SQLite schema and repository functions
  demoData.ts       100-customer dataset generator
  mcp/server.ts     MCP server (adapter over the service layer)
  outreach.ts       Personalized outreach drafts
  relayops.ts       Product-domain service layer
  scheduler.ts      Daily Slack report cron
  scoring.ts        Rebooking priority model
  slackBlocks.ts    Slack Block Kit views (report, App Home, drafts)
scripts/
  mcp.ts            MCP server entry point (npm run mcp)
test/               Vitest suite (scoring, filters, suppression, parser)
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

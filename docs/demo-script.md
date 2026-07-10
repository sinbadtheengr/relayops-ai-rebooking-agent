# Demo Script

## Setup

Run:

```bash
npm install
npm run seed
npm run scan
```

For Slack:

1. Create a Slack app from `manifest.json`.
2. Enable Socket Mode.
3. Copy bot token, app token, and signing secret into `.env`.
4. Run `npm run dev`.
5. Invite RelayOps to a channel or DM it directly.

## Live Demo Flow

1. **Daily scan** — run `/relayops scan`. Show overdue count, high-priority customers, and recoverable revenue.
2. **Grounded Q&A** — DM the app: `Who has not returned in 90 days?`, then `Show overdue VIP customers`. Point out every fact traces to booking data.
3. **Draft outreach** — click `Draft outreach` on a high-priority customer. Show the personalized message using last service, channel preference, and consent.
4. **Close the loop (the money beat)** — click `Mark contacted`. Re-run `/relayops scan` and show that customer is **gone** and the header notes "1 already contacted this cycle — suppressed." No double-contacting, no spammed customers.
5. **App Home dashboard** — open the RelayOps App Home tab. Show live KPIs (recoverable revenue, overdue, high-priority, suppressed) and top opportunities with buttons.
6. **MCP server** — in Claude Desktop (RelayOps configured as an MCP server), ask `Summarize today's RelayOps rebooking opportunities` and `Draft a follow-up for the most overdue VIP`. Same grounded intelligence, outside Slack.

> All six steps run credential-free except the three Slack tokens — no OpenAI key required.

## Judge Talking Points

- **Required tech, done cleanly:** RelayOps ships an MCP server (and a Slack AI-app surface). The same domain core powers Slack and MCP.
- **Not a guessing chatbot:** structured function calls against CRM/appointment data; deterministic fallback when no LLM key is set — every number is verifiable.
- **Complete Slack experience:** slash command, App Home dashboard, DM, mention, Block Kit reports, action buttons, streaming, thinking status.
- **The loop actually closes:** contacted customers are suppressed for a 14-day cooldown — the product keeps the promise its report makes.
- **Human-in-the-loop by design:** drafts for review, never auto-sent customer messages — an invariant preserved even in the MCP tools.
- **Concrete ROI and a real upgrade path:** recovered appointments × average ticket; SQLite → PostgreSQL, CSV/booking connectors, multi-tenant.

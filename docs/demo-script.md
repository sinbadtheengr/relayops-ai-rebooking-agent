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

1. Open Slack and run `/relayops scan`.
2. Show the daily report: overdue count, high-priority customers, and recoverable revenue.
3. Click `Draft outreach` for a high-priority customer.
4. Show the personalized message and explain that it uses customer history, service type, channel preference, and consent.
5. Ask: `Who has not returned in 90 days?`
6. Ask: `Show overdue VIP customers`
7. Ask: `Summarize today's opportunities`
8. Click `Mark contacted` and explain that future scans can avoid stale duplicate work.

## Judge Talking Points

- RelayOps turns forgotten follow-up into a daily revenue workflow inside Slack.
- The AI is not guessing: it uses structured function calls against CRM and appointment data.
- The Slack experience is complete: slash command, app DM, channel mention, Block Kit report, and action buttons.
- The product keeps humans in the loop by drafting outreach for review instead of auto-sending customer messages.
- The product starts with CSV/SQLite and can grow into booking-system integrations and PostgreSQL.
- The ROI is concrete: recovered appointments multiplied by average ticket value.

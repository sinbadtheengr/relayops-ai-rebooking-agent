# Pitch Deck Outline

1. Title: RelayOps AI Rebooking Agent — a Slack-native AI employee that recovers missed rebooking revenue.
2. Problem: Small businesses lose repeat revenue when customers do not rebook — and nobody on staff owns the job of noticing.
3. Customer: Salons, clinics, wellness studios, and home-service SMBs with booking tools but no automation team.
4. Existing Pain: Manual calls, inconsistent staff follow-up, no prioritization, no ROI view.
5. Product: An AI employee in Slack that finds overdue customers, ranks opportunities, drafts outreach, and closes the loop — contacted customers are suppressed from future scans so nobody gets double-contacted.
6. Demo: Daily scan, App Home dashboard, VIP filter, 90-day query, personalized draft, mark-contacted suppression, and the same intelligence in Claude Desktop via MCP.
7. AI Architecture: One domain core, two AI surfaces — Slack (OpenAI tool calling over verified CRM/booking facts, deterministic no-key fallback) and an MCP server for any MCP client. Every number traces to the database; no free-generated customer facts.
8. Human-in-the-Loop by Design: RelayOps drafts, staff review and send — it never messages customers automatically, an invariant preserved across Slack and MCP.
9. Business Value: Recover missed bookings, protect retention, give owners a measurable morning workflow (recoverable revenue quantified per day).
10. Market Entry: Facial boutiques and salons first, then dental, massage, physio, home services.
11. Pricing: $99-$299 per location per month plus optional integration setup.
12. Production Roadmap: Booking connectors (Square, Fresha), consent/opt-out gates, outcome tracking, campaign analytics, multi-location reporting — on a layered architecture with a single SQL module ready for PostgreSQL.
13. Why Now: Slack and MCP are becoming the operational surfaces for AI employees.
14. Ask: Pilot partners and integration access after the hackathon.

# RelayOps AI Rebooking Agent — Project Overview

> Audience: engineers (human or AI) joining the project. Companion documents:
> - [`docs/GAPS_AND_ISSUES.md`](GAPS_AND_ISSUES.md) — prioritized defect and risk backlog
> - [`CLAUDE.md`](../CLAUDE.md) — implementation-level reference (features, flows, data models, edge cases)
> - [`docs/architecture.md`](architecture.md) — architecture diagram and data flow

---

## 1. What This Project Is

RelayOps is a **Slack-native AI agent** for appointment-based small businesses (salons, dental clinics, massage/physio clinics, cleaning and home services). It solves one problem: **customers who don't rebook after their last appointment are silently lost revenue**, and no one on staff owns the job of noticing.

Every morning, RelayOps:

1. Scans CRM/booking data (currently a seeded SQLite demo dataset) for customers past their typical return cycle.
2. Scores and ranks them by overdue gap, spend, loyalty, VIP status, and marketing consent.
3. Posts a Block Kit report to Slack with estimated recoverable revenue and per-customer action buttons.
4. Answers natural-language staff questions in DMs, channel mentions, and via `/relayops`.
5. Drafts personalized SMS/email/phone outreach for staff to review — **it never contacts customers directly** (human-in-the-loop by design).

The project originated as a hackathon MVP (UiPath AgentHack, then repositioned for the Slack Builder Challenge). It is a working demo with a deliberate production upgrade path, not yet a production system.

## 2. Goals

| Goal | Status |
|---|---|
| Working Slack agent: slash command, DMs, mentions, buttons, suggested prompts | ✅ Implemented |
| Priority scoring model over customer/appointment data | ✅ Implemented |
| AI tool-calling (OpenAI) grounded in structured data, with deterministic fallback | ✅ Implemented |
| 100-customer demo dataset, runnable with zero credentials | ✅ Implemented |
| Scheduled morning report via cron | ✅ Implemented |
| Follow-up state (contacted customers drop out of future reports) | ✅ Implemented — 14-day cooldown suppression (G-01) |
| MCP server exposing the service layer to any MCP client | ✅ Implemented (`npm run mcp`) |
| App Home dashboard with KPIs and action buttons | ✅ Implemented |
| Automated tests + CI | ✅ Implemented — Vitest (`npm test`), GitHub Actions build+test |
| Multi-tenant, real booking connectors, consent enforcement, audit logs | ❌ Roadmap only |

**Non-goals (current phase):** sending customer outreach automatically, payment/booking write-back, non-Slack UI.

## 3. Feature Summary

| Feature | Entry point | Description |
|---|---|---|
| Daily rebooking scan | `/relayops` or `/relayops scan` | In-channel Block Kit report: overdue count, recoverable revenue, top 5 customers with action buttons |
| Natural-language Q&A | `/relayops <question>`, app mention, DM | Routes to `answerBusinessQuestion()` — OpenAI tool-calling or deterministic keyword parser |
| Outreach drafting | "Draft outreach" button, "draft" questions | Channel-aware templates (SMS/email/phone script) personalized per customer |
| Mark contacted | "Mark contacted" button | Logs the contact (with acting user) and suppresses the customer from scans for a 14-day cooldown |
| App Home dashboard | RelayOps Home tab | Live KPIs (recoverable revenue, overdue, high-priority, suppressed) + top opportunities with buttons |
| MCP server | `npm run mcp` | Five tools over stdio exposing the same service layer to any MCP client (Claude Desktop, IDEs); credential-free |
| Suggested prompts | Assistant thread started | Four canned prompts via `assistant.threads.setSuggestedPrompts` |
| Scheduled scan | `node-cron`, opt-in via env | Posts the daily summary to `SLACK_REPORT_CHANNEL_ID` on `DAILY_SCAN_CRON` |
| CLI demo tools | `npm run seed / scan / demo:ask` | Everything works offline without Slack or OpenAI credentials |

## 4. Tech Stack

- **Language/runtime:** TypeScript (strict-ish, ESM `"type": "module"`), Node.js ≥ 20, run via `tsx`
- **Slack:** `@slack/bolt` v4, Socket Mode (no public URL needed); `manifest.json` defines scopes and events
- **AI:** `openai` SDK, Chat Completions with function tools, model default `gpt-4o-mini`; fully optional — deterministic fallback in `src/agent.ts`
- **Storage:** SQLite via `better-sqlite3` (synchronous), WAL mode, file at `./data/relayops.db`; schema auto-migrates on first connection
- **Scheduling:** `node-cron` with timezone support
- **Config:** `dotenv` + `zod` schema in `src/config.ts`

### Module Map

| File | Responsibility |
|---|---|
| `src/app.ts` | Slack runtime: Bolt app, command/event/action handlers, startup seeding |
| `src/agent.ts` | AI layer: OpenAI tool-calling loop, tool definitions, deterministic fallback parser |
| `src/relayops.ts` | Domain service layer: opportunity filtering, summaries, drafts, contact logging |
| `src/scoring.ts` | Priority model: score components, priority bands, likelihood, revenue estimate |
| `src/db.ts` | SQLite connection, schema migration, repository functions |
| `src/outreach.ts` | Per-channel outreach message templates |
| `src/slackBlocks.ts` | Block Kit view builders |
| `src/scheduler.ts` | Daily cron job |
| `src/demoData.ts` | Deterministic 100-customer dataset generator |
| `src/config.ts` | Env config with zod validation |
| `src/types.ts` | Shared domain types |
| `src/utils.ts` | Currency/date formatting, `daysBetween`, `clamp` |
| `src/mcp/server.ts` | MCP server adapter over the service layer (five stdio tools) |
| `scripts/*.ts` | CLI entry points (`seed`, `run-daily-scan`, `demo-query`, `mcp`) |
| `test/*.test.ts` | Vitest suite (scoring, filters, suppression, deterministic parser, timezone) |

### Layering rule

```
app.ts / scheduler.ts / scripts   (adapters — Slack & CLI)
        ↓
agent.ts                          (AI orchestration)
        ↓
relayops.ts                       (domain services — the only layer adapters should call for data)
        ↓
scoring.ts / outreach.ts          (pure domain logic)
        ↓
db.ts                             (persistence — SQLite today, PostgreSQL later)
```

The PostgreSQL upgrade path depends on keeping `db.ts` the only module that touches SQL. `slackBlocks.ts` currently violates layering by calling `createOutreachDraft` directly (view importing service) — acceptable for now, noted in gaps.

## 5. Runbook

```bash
npm install
cp .env.example .env        # credentials optional for local demo
npm run seed                # reset + seed 100 customers into ./data/relayops.db
npm run scan                # print the daily report to stdout (no Slack needed)
npm run demo:ask -- "Show overdue VIP customers"
npm run dev                 # start the Slack app (requires SLACK_* env vars)
npm run build && npm start  # compiled production run
npm test                    # Vitest suite — hermetic, no credentials
npm run mcp                 # MCP server on stdio — no credentials
```

Slack setup: create an app from `manifest.json`, enable Socket Mode, create an app token with `connections:write`, install, fill `.env`. See README "Slack Setup".

Verification = `npm run build && npm test` + the CLI scripts + manual Slack testing. GitHub Actions runs build + test on every push/PR. There is no lint config yet.

## 6. Data Model (summary)

Three SQLite tables — full column detail, derived types, and invariants are in [`CLAUDE.md` §4](../CLAUDE.md).

- **`customers`** — profile, preferred channel, VIP flag, `typical_return_days` (expected rebooking cycle), lifetime/average spend in **cents**, `marketing_consent`.
- **`appointments`** — per-visit rows: service type/date, revenue cents, staff member, status (`completed | cancelled | no_show`).
- **`outreach_logs`** — one row per staff contact action (channel, message, status, timestamp). Written today, **never read** — wiring this into scoring is gap G-01.

Derived (in-memory) shapes: `CustomerRecord` (customer + latest completed visit + visit count) → `CustomerInsight` (adds score, priority, likelihood, recoverable revenue, recommended channel, selection reason).

## 7. Milestones

### M0 — Hackathon MVP ✅ (complete)
Everything in §3. Demo-ready with seeded data, docs, pitch deck, video script.

### M1 — Correctness & Trust (next)
Make the demo honest and the loop actually close. Work items are specified in `GAPS_AND_ISSUES.md`; the critical ones:

- **Close the follow-up loop:** contacted customers suppressed from reports for a cooldown window (G-01).
- Error handling so one failed Slack API call can't kill a handler or the cron process (G-02, G-03).
- Validate AI tool arguments; stop silently swallowing tool errors (G-06, G-07).
- Minimal test suite: scoring, filters, deterministic parser, suppress-after-contact (G-05).
- PII hygiene in shared channels and authorization on actions (S-01); keep the committed submission zip free of secrets — audited clean 2026-07-06 (S-02).

### M2 — Pilot-ready single tenant
- Real data ingestion: CSV import first, then one booking connector (e.g. Square or Fresha).
- Consent/opt-out enforcement as a hard gate, not a scoring penalty.
- Outreach log becomes the system of record: statuses (`drafted → contacted → rebooked / declined / no-response`), snooze, per-customer history.
- App Home tab, pagination beyond top 5, per-user preferences.
- PostgreSQL repository behind the existing `db.ts` interface; migrations tooling.

### M3 — Multi-tenant product
- Workspace/tenant isolation (row-level `tenant_id`, per-tenant config, OAuth install flow replacing Socket Mode single-workspace).
- Audit logs for AI drafts and staff actions.
- RAG over customer notes / staff playbooks; outcome tracking (did they rebook?) to calibrate the likelihood model.
- Billing, admin controls, role-based Slack actions.

## 8. Key Design Decisions

1. **AI never free-generates customer facts.** The system prompt forces tool calls; the deterministic fallback uses the same scored data. Every number in a Slack message traces to SQLite.
2. **Graceful degradation everywhere:** no OpenAI key → deterministic templates; no Slack credentials → CLI scripts still work. Keep this property when adding features.
3. **Human-in-the-loop outreach** is a product stance (and a challenge-judging criterion), not a temporary limitation.
4. **Money is integer cents** end-to-end; format only at the display edge (`formatCurrency`).
5. **Dates are ISO `YYYY-MM-DD` strings**, compared at a fixed `T12:00:00Z` to dodge DST/timezone drift (see `utils.ts`).
6. **Demo data is deterministic** (index-based `jitter()`, no `Math.random`) so demos and future tests are reproducible.

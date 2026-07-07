# CLAUDE.md — RelayOps AI Rebooking Agent

Implementation reference for AI coding agents and engineers. Read this before changing code.

- Product/roadmap context: [`docs/PROJECT_OVERVIEW.md`](docs/PROJECT_OVERVIEW.md)
- Prioritized defect backlog with fix specs: [`docs/GAPS_AND_ISSUES.md`](docs/GAPS_AND_ISSUES.md)

## 1. What this is

A Slack-native agent (TypeScript, Bolt v4, Socket Mode) that finds customers overdue for rebooking in a SQLite CRM dataset, scores them, posts Block Kit reports, answers natural-language questions (OpenAI tool-calling with a deterministic no-key fallback), and drafts outreach for staff review. It never messages customers directly — human-in-the-loop is a product invariant, not a TODO.

## 2. Commands

```bash
npm install                                   # Node >= 20 required (better-sqlite3 native build)
npm run seed                                  # wipe + reseed 100 demo customers into ./data/relayops.db
npm run scan                                  # print daily report to stdout — needs NO credentials
npm run demo:ask -- "Show overdue VIP customers"   # ask one question via CLI — needs NO credentials
npm run dev                                   # start Slack app (requires SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_SIGNING_SECRET)
npm run dev:watch                             # same, with tsx watch
npm run build                                 # tsc → dist/ (this is also the only typecheck)
npm start                                     # ⚠ currently broken: runs dist/app.js but tsc emits dist/src/app.js (gap G-04)
```

There is **no test suite yet** (gap G-05). Until one exists, verify changes with: `npm run build` (must pass), then `npm run seed && npm run scan` and a few `npm run demo:ask` queries. These CLI paths exercise db → scoring → relayops → agent without Slack.

Config comes from `.env` (see `.env.example`). Everything except the three Slack tokens is optional; OpenAI is optional (fallback engages automatically).

## 3. Architecture and layering

```
src/app.ts, src/scheduler.ts, scripts/*        adapters (Slack runtime, cron, CLI)
        │  call
src/agent.ts                                   AI orchestration (OpenAI tool loop + deterministic parser)
        │  call
src/relayops.ts                                domain services — the ONLY data API for upper layers
        │  call
src/scoring.ts, src/outreach.ts                pure domain logic (no I/O)
        │  call
src/db.ts                                      persistence — the ONLY module allowed to contain SQL
```

Rules when adding code:

- New SQL goes in `src/db.ts` only. The planned PostgreSQL migration swaps this one file.
- Adapters (`app.ts`, scripts) must not import `db.ts` for business reads — go through `relayops.ts`. (Existing exception: `app.ts:17` checks `listCustomerRecords().length` for startup seeding; keep it that way or wrap it, don't add more.)
- `slackBlocks.ts` should be pure `data → KnownBlock[]` functions. `outreachDraftBlocks` currently violates this by calling `createOutreachDraft` (gap G-16); don't copy that pattern.
- `scoring.ts` and `outreach.ts` must stay pure (no db, no Slack, no network) — they are the easiest units to test.

## 4. Data models

### 4.1 SQLite tables (created idempotently in `src/db.ts:20-60` on first `getDb()`)

```sql
customers (
  id TEXT PRIMARY KEY,              -- format: cus_001 … cus_100 in demo data
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  business_type TEXT NOT NULL,      -- e.g. "Salon", "Dental clinic" (free text, from demo profile)
  preferred_channel TEXT NOT NULL,  -- 'sms' | 'email' | 'phone'
  vip INTEGER NOT NULL,             -- 0 | 1  (booleans are stored as 0/1 everywhere)
  typical_return_days INTEGER NOT NULL,  -- expected rebooking cycle; THE key scoring input
  total_spend_cents INTEGER NOT NULL,
  average_ticket_cents INTEGER NOT NULL,
  marketing_consent INTEGER NOT NULL,    -- 0 | 1; 0 penalizes score and forces phone channel
  notes TEXT NOT NULL,
  created_at TEXT NOT NULL          -- ISO date string
)

appointments (
  id TEXT PRIMARY KEY,              -- demo format: apt_<customer#>_<visit#>
  customer_id TEXT NOT NULL REFERENCES customers(id),
  service_type TEXT NOT NULL,
  service_date TEXT NOT NULL,       -- ISO YYYY-MM-DD
  revenue_cents INTEGER NOT NULL,
  staff_member TEXT NOT NULL,
  status TEXT NOT NULL              -- 'completed' | 'cancelled' | 'no_show'; ONLY 'completed' counts anywhere
)

outreach_logs (
  id TEXT PRIMARY KEY,              -- out_<timestamp>_<random>
  customer_id TEXT NOT NULL REFERENCES customers(id),
  channel TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL,             -- currently always 'contacted'; G-08 adds 'drafted'
  created_at TEXT NOT NULL          -- full ISO timestamp
)
```

⚠ `REFERENCES` clauses are currently **not enforced** — `PRAGMA foreign_keys` is never turned on (gap G-10).
⚠ `outreach_logs` is write-only today: `recordOutreach` inserts, nothing selects. Making scoring read it is gap G-01 — check whether it landed before assuming either behavior.

### 4.2 Derived in-memory types (`src/types.ts`)

- `Customer` — camelCase mirror of the `customers` row (booleans as real booleans).
- `CustomerRecord = Customer + { lastVisitDate, lastServiceType, appointmentCount }` — built by the join in `listCustomerRecords()` (`src/db.ts:102`). **Only completed appointments count**; customers with zero completed appointments are excluded entirely by the INNER JOIN (edge case §7.1).
- `CustomerInsight = CustomerRecord + scoring outputs` — see §5. This is the shape the AI tools return and Slack blocks render.
- `DailySummary` — counts, total recoverable revenue, `topOpportunities` (max 10), hardcoded `recommendedActions` strings (`src/scoring.ts:62-66`).

### 4.3 Unit and format invariants (do not break these)

| Concern | Rule | Where enforced |
|---|---|---|
| Money | integer **cents** everywhere; format only at display via `formatCurrency` | `src/utils.ts:1-7` |
| Dates (domain) | ISO `YYYY-MM-DD` strings; parse with `T12:00:00Z` suffix to dodge TZ/DST off-by-one | `src/utils.ts:9-25` |
| Timestamps (logs) | full `new Date().toISOString()` | `src/db.ts:194` |
| Booleans in SQLite | 0/1 integers, converted at the repository boundary | `src/db.ts:84-100,153` |
| IDs | opaque strings, prefixed (`cus_`, `apt_`, `out_`) | `src/demoData.ts`, `src/db.ts:189` |

## 5. Scoring model (exact spec — `src/scoring.ts`)

For a `CustomerRecord`:

```
daysSinceLastVisit = daysBetween(lastVisitDate, today)           # floor of whole days, min 0
daysOverdue        = max(0, daysSinceLastVisit - typicalReturnDays)
overdueRatio       = daysOverdue / max(typicalReturnDays, 1)

recencySignal  = clamp(overdueRatio * 58, 0, 58)                 # dominant term
valueSignal    = clamp(averageTicketCents / 550, 0, 22)          # caps at a $121 avg ticket
loyaltySignal  = clamp(appointmentCount * 2.4, 0, 12)            # caps at 5 visits
vipSignal      = vip ? 8 : 0
consentSignal  = marketingConsent ? 0 : -12

priorityScore  = round(clamp(sum of signals, 0, 100))
priority       = score >= 78 ? "High" : score >= 48 ? "Medium" : "Low"

rebookingLikelihood = clamp(0.22 + overdueRatio*0.18 + appointmentCount*0.025 + (vip?0.08:0), 0.12, 0.91)  # 2dp
estimatedRecoverableRevenueCents = round(averageTicketCents * rebookingLikelihood)
recommendedChannel = marketingConsent ? preferredChannel : "phone"    # compliance caveat: gap S-03
```

`rankOpportunities` maps → scores, **drops `daysOverdue === 0`**, sorts by `priorityScore` desc, tie-break `estimatedRecoverableRevenueCents` desc. `summarizeOpportunities` sums revenue over *all* overdue customers (not just top 10) and keeps `topOpportunities = slice(0, 10)`.

If you change any constant here, the demo narrative (docs/demo-script.md) and any tests must be re-checked; priorities band-shift easily because `recencySignal` dominates.

## 6. Features in detail

### 6.1 `/relayops` slash command — `src/app.ts:53-67`
- `ack()` immediately (Slack's 3-second rule), then respond via `respond` (response_url — works even where the bot isn't a channel member).
- Empty text or `scan` → **in-channel** Block Kit daily summary (`dailySummaryBlocks`). ⚠ In-channel means visible to everyone present — PII consideration, gap S-01.
- Any other text → treated as a natural-language question via `respondToPrompt` → default-ephemeral text answer.
- Note the `as never` casts on `respond({...blocks})` — Bolt v4 typing friction, intentional; keep if you must, but don't spread them.

### 6.2 Natural-language Q&A — `src/agent.ts`
`answerBusinessQuestion(question)` is the single entry point used by all surfaces.

**OpenAI path** (when the key passes `hasUsableOpenAiKey` — must start with `sk-`, length > 20, not contain "your"):
1. First completion: system prompt ("use tools for all customer facts… never invent customers"), user question, 3 tools, `tool_choice: "auto"`, temp 0.2.
2. If tool calls returned: execute each via `runTool`, feed results back in a **second** completion (currently no `tools` param → single round only; gap G-06).
3. Any throw anywhere → deterministic fallback (currently logs no error detail; gap G-06).

**Tools** (`src/agent.ts:68-110`) — these are the AI's entire data surface, all read-only:
- `get_rebooking_opportunities(priority?, vipOnly?, minDaysSinceLastVisit?, minDaysOverdue?, serviceType?, limit=8)` → `CustomerInsight[]`
- `draft_follow_up(customerId!, tone?)` → `{ customer, message }`
- `summarize_today()` → `DailySummary`
⚠ Arguments are unvalidated model output (gap G-07): `priority` is case-sensitive, `limit` unbounded, bad `customerId` throws.

**Deterministic fallback** (`parseDeterministicIntent`, `src/agent.ts:36-66`) — substring keyword routing, checked in this order: summary/opportunities/recoverable revenue → daily summary text; "draft" → draft for top match; otherwise filtered list. Keywords: "high", "medium", "vip", "90", "today"/"contact". Loose matching is a known limitation (gap G-12). When adding a tool to the OpenAI path, add a corresponding keyword branch here — the fallback must stay at feature parity for credential-free demos.

### 6.3 Outreach drafting — `src/outreach.ts`
Pure template function keyed on `recommendedChannel`:
- `sms` → short two-sentence text with first name and last service.
- `email` → includes `Subject:` line, multi-paragraph.
- `phone` → a **script for staff** (not a customer message): mentions days overdue and expected recovery value. This asymmetry is intentional — non-consenting customers get a staff call script, never a direct message draft.
- `tone` parameter is only used in the phone branch today.

### 6.4 Block Kit report + buttons — `src/slackBlocks.ts`, handlers in `src/app.ts:132-162`
- `dailySummaryBlocks`: header → stats section → top **5** customers (each: section + context + two buttons) → recommended actions. Slack caps messages at 50 blocks; each customer costs 4 — don't raise the top-5 slice without checking the cap.
- Button `action_id`s: `draft_customer`, `mark_contacted`; `value` = customer id. Buttons on old messages survive re-seeds and then reference dead ids (edge case §7.6, gap G-09).
- `mark_contacted` → `markCustomerContacted(id, "Contacted from Slack action")` → inserts `outreach_logs` row (placeholder message — gap G-08) → ephemeral confirmation.
- `draft_customer` → ephemeral draft with its own *Mark contacted* button.

### 6.5 DMs, mentions, assistant threads — `src/app.ts:69-130`
- `app_mention`: strips `<@USERID>` tokens, adds 👀 reaction (⚠ unguarded await — gap G-03), sets assistant status if available, answers in-thread (`thread_ts` = existing thread or the mention's own ts). Empty mention text defaults to "Summarize today's opportunities".
- `message` handler: **only** `channel_type === "im"`, and ignores anything with `bot_id`, `app_id`, `subtype`, or missing `user`. That guard is the fix for a real self-reply infinite loop (commit 06dc0f3) — never weaken it. Empty DM defaults to "Which customers should we contact today?".
- `assistant_thread_started`: sets 4 suggested prompts. Registered with `as never` / `any` because Bolt's typings lag the assistant API; wrapped in try/catch already.
- `sayStream` (streaming markdown) is used when the surface provides it; the full response is appended in one chunk (no incremental streaming yet).

### 6.6 Scheduled daily scan — `src/scheduler.ts`
No-op unless `DAILY_SCAN_ENABLED=true` **and** `SLACK_REPORT_CHANNEL_ID` set. Default cron `0 8 * * 1-6` (Mon–Sat 08:00) in `TIMEZONE` (default America/Toronto). Posts the same blocks as `/relayops scan` plus `formatDailySummaryText()` as notification fallback text. ⚠ Callback has no error handling — one failed post can kill the process (gap G-02).

### 6.7 Demo data — `src/demoData.ts`
Fully deterministic (index arithmetic + `jitter()`, **no `Math.random`**): 100 customers over 10 service profiles, 2–9 completed appointments each, spaced by the profile's cycle. Overdue-ness pattern: every 5th customer very overdue (cycle + 55–95 days), every 3rd moderately, rest mostly current. Every 11th lacks marketing consent; every 9th (or spend > $1,200) is VIP. `seedDemoData()` **wipes all three tables first** — including real `outreach_logs` (edge case §7.6). Auto-runs on app/script start when the customers join yields zero rows.

## 7. Edge cases catalog

Check these when modifying the touching code; each is a candidate test case.

1. **Customer with no completed appointments** — invisible everywhere (INNER JOIN in `listCustomerRecords`). Cancelled/no-show-only customers are unreachable (gap G-15). Don't "fix" casually: scoring divides by return cycles that assume a real last visit.
2. **`daysOverdue === 0`** — customer excluded from opportunities even if due *today*. Filter boundary is `> 0` (`src/scoring.ts:43`).
3. **Future-dated appointments** — `daysBetween` clamps at 0, so `daysSinceLastVisit = 0` → not overdue. Imported data with pre-booked future visits will hide those customers; that's correct behavior, document it in connectors.
4. **`typicalReturnDays <= 0`** — guarded by `max(typicalReturnDays, 1)` in the ratio, but a 0 value would make everyone instantly overdue. Demo data never produces it; CSV import (MF-02) must validate it.
5. **No overdue customers at all** — `dailySummaryBlocks` renders stats + recommended actions with zero customer sections (no empty state); `formatDailySummaryText` prints "No overdue customers today."; deterministic parser returns its own not-found strings. Only the text path has a friendly empty state.
6. **Stale buttons after re-seed** — `npm run seed` regenerates the same ids (`cus_001`…) so buttons *usually* still resolve, but to a different person-name mapping only if the generator changed; if a customer id disappears, `createOutreachDraft` throws and the click silently no-ops (gaps G-09, G-08).
7. **Slack event redelivery** — Slack retries events not acked within ~3s. For mentions this re-adds 👀 (`already_reacted` throw — gap G-03) and answers twice. Handlers are not idempotent; keep them fast.
8. **Message subtypes in DM** — edits (`message_changed`), deletions, joins all carry `subtype` and are correctly ignored; so are messages from any bot. A DM from another *app* with no `bot_id` but an `app_id` is also ignored.
9. **OpenAI returns neither content nor tool calls** — falls through to `parseDeterministicIntent` (`src/agent.ts:154,177`); never return empty string to Slack.
10. **Config edge:** `hasUsableOpenAiKey` rejects placeholder keys like `sk-your-key` (contains "your") so a fresh `.env.example` copy cleanly uses the fallback; an *invalid but plausible* key engages the OpenAI path and relies on the runtime catch (commit 4e91c96 context).
11. **Evening UTC skew** — after ~19:00–20:00 Toronto time, "today" moves a day ahead (gap G-13); day-granularity math tolerates it, report header date does not.
12. **Concurrent writes** — better-sqlite3 is synchronous single-connection; no async races within the process, but long queries block the event loop. Keep repository functions small.

## 8. Conventions and gotchas

- **ESM everywhere**: `"type": "module"` + `moduleResolution: NodeNext` ⇒ relative imports **must** carry a `.js` extension even in `.ts` files (`import { config } from "./config.js"`). Forgetting this compiles-then-crashes at runtime.
- **Config is read at import time** (`src/config.ts` runs `dotenv.config()` and parses env on module load). Tests or scripts that need different env must set variables *before* the first import of anything that transitively imports config.
- **DB connection is a lazy singleton** (`getDb()`); the schema migrates on first touch. `DATABASE_URL` may carry an optional `sqlite://` prefix, which is stripped; any other scheme is *not* rejected (gap G-14).
- **Seeding is destructive and automatic**: `app.ts`, `run-daily-scan.ts`, and `demo-query.ts` all seed when the customers table is empty; `scripts/seed.ts` always wipes. Never point `DATABASE_URL` at real data while these behaviors exist.
- **Style**: 2-space indent, double quotes, semicolons, named exports only, no default exports, no classes — modules of plain functions. Types live in `types.ts` unless private to a module. No lint config exists; match what you see.
- **Bolt typing friction** is handled with narrow inline casts (`as never`, event field casts in `app.ts`). Contain casts to the adapter layer; domain code must stay fully typed.
- **`dist/` and `data/` are gitignored build/runtime artifacts**; the committed `*.zip`/`*.pptx` are hackathon deliverables — don't regenerate them incidentally (gap S-02).
- **Docs that must stay in sync** when behavior changes: `README.md` (feature list, setup), `docs/demo-script.md` (narrative depends on scoring output), this file.

## 9. How to implement changes here (checklist for coding agents)

1. **Pick work from [`docs/GAPS_AND_ISSUES.md`](docs/GAPS_AND_ISSUES.md)** in its stated fix order unless directed otherwise. Each entry contains the fix specification; this file gives you the surrounding invariants.
2. Respect the layering table in §3 — decide which layer owns your change before writing code. New SQL → `db.ts`; new business rule → `relayops.ts`/`scoring.ts`; new Slack surface → `app.ts` + `slackBlocks.ts`; new AI capability → tool in `agent.ts` **plus** a fallback branch in `parseDeterministicIntent`.
3. Keep the zero-credential demo working: after any change, `npm run build && npm run seed && npm run scan && npm run demo:ask -- "Show overdue VIP customers"` must all succeed with an empty-credentials `.env`.
4. If tests exist (post G-05), run `npm test`; when you touch `scoring.ts`, `relayops.ts`, `agent.ts` (fallback), or `db.ts`, add/extend tests in the same change.
5. For Slack-visible changes you cannot verify locally, state that explicitly — the maintainer tests against a real workspace with `npm run dev`.
6. Never add: auto-sending of customer outreach without an explicit approval step (product invariant); `Math.random`/`Date.now()` in demo data (determinism); SQL outside `db.ts`; floating-point money.
7. Update the gaps register: mark fixed items with a `✅ Fixed <date> <commit>` line rather than deleting them; renumbering IDs is forbidden (they're referenced across docs).

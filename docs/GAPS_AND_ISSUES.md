# RelayOps — Gaps and Issues Register

> Prioritized backlog of confirmed bugs, missing features, security/compliance holes, and technical risks, identified by code audit on 2026-07-06.
> Each entry has a stable ID (`G-xx` functional, `S-xx` security/privacy, `MF-xx` missing feature), severity, exact location, failure scenario, and a fix specification precise enough to implement directly.
> Companion docs: [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md) (roadmap context), [`CLAUDE.md`](../CLAUDE.md) (implementation reference).

**Severity scale**
- **Critical** — product behaves contrary to its documented promise, or data loss/leak
- **High** — crashes, broken commands, or must-fix before any real-user pilot
- **Medium** — wrong/degraded behavior in realistic scenarios, or debt that blocks the next milestone
- **Low** — polish, hardening, hygiene

**Suggested fix order:** G-01 → G-02 → G-03 → G-04 → G-05 → S-01 → G-06 → G-07 → then Medium/Low as convenient. G-05 (tests) should land alongside G-01 so the core loop is regression-protected.

---

## Critical

### G-01 · Bug · "Mark contacted" has no effect on future reports
- ✅ Fixed 2026-07-09 (Slack Challenge hardening): `getRecentlyContactedCustomerIds` in `db.ts`; `CONTACT_COOLDOWN_DAYS = 14` + `rankedWithSuppression` + `includeContacted` flag in `relayops.ts`; `recentlyContactedCount` added to `DailySummary` and surfaced in the report, App Home, and text summary. Covered by `test/relayops.test.ts` (suppression + cooldown expiry).
- **Location:** `src/scoring.ts:40-48` (`rankOpportunities`), `src/db.ts:180-196` (`recordOutreach`), `src/relayops.ts:54-59`
- **What happens:** The *Mark contacted* button writes a row to `outreach_logs`, but nothing ever reads that table. `rankOpportunities()` ranks purely from `customers` + `appointments`. The daily report itself tells staff to "log contacted customers so tomorrow's report focuses on fresh opportunities" (`src/scoring.ts:65`) — a promise the code does not keep.
- **Failure scenario:** Staff marks Sarah Johnson contacted on Monday. Tuesday's scan shows Sarah as the #1 opportunity again. Staff contacts her twice; trust in the product dies; a real customer gets spammed.
- **Fix specification:**
  1. In `src/db.ts`, add:
     ```ts
     export function getRecentlyContactedCustomerIds(sinceIso: string): Set<string> {
       const rows = getDb()
         .prepare(`SELECT DISTINCT customer_id FROM outreach_logs WHERE status = 'contacted' AND created_at >= ?`)
         .all(sinceIso) as Array<{ customer_id: string }>;
       return new Set(rows.map((r) => r.customer_id));
     }
     ```
  2. In `src/relayops.ts`, add a module constant `CONTACT_COOLDOWN_DAYS = 14`. In `getOpportunities()` and `getDailySummary()`, compute `sinceIso` (now minus cooldown, ISO string) and filter ranked results: drop customers whose id is in the set, **unless** a new filter flag `includeContacted: true` is passed (so the AI can still answer "who have we already contacted?").
  3. Optionally surface contacted-and-suppressed count in `DailySummary` (add `recentlyContactedCount: number`) and show it in `dailySummaryBlocks` context.
  4. Test (see G-05): mark a seeded customer contacted → assert absent from `getOpportunities()`; assert present again when the log row is older than the cooldown.

---

## High

### G-02 · Bug · Scheduled scan can crash the process on a single Slack failure
- ✅ Fixed 2026-07-09: cron callback body wrapped in try/catch, logs and swallows so the next run still fires.
- **Location:** `src/scheduler.ts:11-21`
- **What happens:** The `cron.schedule` callback awaits `chat.postMessage` with no try/catch. Any failure (revoked token, archived channel, `channel_not_found`, transient network) becomes an unhandled promise rejection — fatal by default on Node ≥ 20.
- **Failure scenario:** The report channel is archived; at 08:00 the post fails and the whole Slack app exits. The business loses not just the report but the interactive agent, silently, until someone restarts it.
- **Fix specification:** Wrap the callback body in `try { ... } catch (error) { console.error("Daily scan failed to post to Slack:", error); }`. Do not rethrow; the next scheduled run should still fire.

### G-03 · Bug · A failed emoji reaction aborts the entire app-mention response
- ✅ Fixed 2026-07-09: `reactions.add` and `setStatus` each wrapped in their own try/catch; the answer no longer depends on decorations.
- **Location:** `src/app.ts:73-79`
- **What happens:** `client.reactions.add` is awaited before answering, outside any try/catch. It fails with `already_reacted` (user edits their mention, Slack redelivers), on deleted messages, and in any surface where reactions are disallowed. The thrown error skips `respondToPrompt`, so the user gets 👀-less silence — or nothing at all.
- **Failure scenario:** Slack retries an event (it redelivers on any ack slower than 3s); second delivery throws `already_reacted`; the user's question never gets answered.
- **Fix specification:** Wrap only the `reactions.add` call in `try { ... } catch { /* non-fatal */ }`. The reaction is decoration; the answer is the job. Apply the same principle to `setStatus`.

### G-04 · Bug · `npm start` is broken — compiled entry point path is wrong
- ✅ Fixed 2026-07-09: `package.json` `start` now runs `node dist/src/app.js`.
- **Location:** `package.json:11` vs `tsconfig.json:10-14`
- **What happens:** `tsconfig.json` has `rootDir: "."` and includes both `src/` and `scripts/`, so `tsc` emits `dist/src/app.js` and `dist/scripts/*.js`. But the start script runs `node dist/app.js`, which does not exist. Verified: the existing `dist/` output contains `dist/src/app.js`.
- **Failure scenario:** Anyone following the "production" path (`npm run build && npm start`) gets `ERR_MODULE_NOT_FOUND` immediately.
- **Fix specification:** Change `package.json` `"start"` to `"node dist/src/app.js"`. (Alternative — `rootDir: "src"` — breaks compiling `scripts/`; don't.) Also note `"dev": "node --import tsx src/app.ts"` and `"dev:watch": "tsx watch src/app.ts"` are the supported dev paths; leave them.

### G-05 · Missing · Zero automated tests, no lint, no CI
- ✅ Mostly fixed 2026-07-09/07-10: Vitest added (`npm test`), hermetic in-memory DB via `test/setup.ts`. Suite covers scoring components/bands + `daysOverdue===0` exclusion, `getOpportunities` filters, `createOutreachDraft` throw-on-unknown, G-01 suppression + cooldown expiry, and deterministic agent routing (19 tests). GitHub Actions CI runs `build + test` on push/PR (`.github/workflows/ci.yml`). Remaining: lint config.
- **Location:** repository-wide; `package.json` has no `test` script
- **What happens:** Scoring math, filters, the deterministic parser, and SQL queries have no regression protection. Every fix in this register lands unverified.
- **Failure scenario:** A future change to `scoreCustomer` silently reorders priorities; the demo shows a Low-priority customer as #1; nobody notices until a live demo.
- **Fix specification:**
  1. Add `vitest` as a devDependency and `"test": "vitest run"` script.
  2. Make tests hermetic: set `DATABASE_URL` to a temp file (or `:memory:`) **before** importing `src/config.ts` — config reads env at import time.
  3. Minimum suite (in `test/`):
     - `scoring.test.ts`: `scoreCustomer` component math and clamps (VIP +8, no-consent −12, recency cap 58); priority bands at scores 47/48/77/78; `rankOpportunities` excludes `daysOverdue === 0` and sorts by score then revenue.
     - `relayops.test.ts`: each `OpportunityFilters` field; `createOutreachDraft` throws on unknown id; (after G-01) contact suppression + cooldown expiry.
     - `agent.test.ts`: `parseDeterministicIntent` routing — "summary" → daily summary text, "draft" → draft text, "vip"/"high"/"90" filters.
     - `demoData.test.ts`: seeding yields 100 customers, every customer has ≥ 2 completed appointments, re-seeding is idempotent (still 100).
  4. Optional: GitHub Actions workflow running `npm run build && npm test` on push.

### S-01 · Security/Privacy · Customer PII broadcast in-channel; no authorization on actions
- **Location:** `src/app.ts:57-64` (`response_type: "in_channel"`), `src/slackBlocks.ts`, `src/app.ts:132-162` (action handlers)
- **What happens:** `/relayops scan` posts customer full names, visit history, spend-derived revenue figures, and VIP status **visibly to everyone in the channel**, and the scheduled scan does the same in `SLACK_REPORT_CHANNEL_ID`. Any workspace member in that channel can also click *Mark contacted* / *Draft outreach* — there is no role check and no record of *who* clicked (the outreach log stores no Slack user id).
- **Failure scenario:** The app is invited to a semi-public channel; every employee (or multi-org guest) sees the client list and per-client spend. A guest clicks *Mark contacted* on 20 customers and quietly suppresses them from reports (after G-01 lands, this becomes a data-integrity attack).
- **Fix specification (phased):**
  1. Now: capture the acting user — in both action handlers, read `body.user.id` and store it in the outreach log message or a new `actor` column; document that the report channel must be private (README + `CLAUDE.md`).
  2. Now: add optional env `RELAYOPS_ALLOWED_USER_IDS` (comma-separated). If set, action handlers and `/relayops` verify membership and reply ephemerally "You're not authorized to use RelayOps" otherwise.
  3. M2: role model per tenant; consider making the scan default to ephemeral with an explicit `scan --share` to post in-channel.

---

## Medium

### G-06 · Bug · AI layer swallows all errors blind, and supports only one tool round
- ✅ Fixed 2026-07-13: `answerBusinessQuestion` now runs a bounded tool loop (max 4 rounds, `tools` passed every round) so the model can chain calls (find → draft); tool failures return `{error}` tool results instead of throwing; the outer catch logs the actual error before falling back.
- **Location:** `src/agent.ts:133-182`
- **What happens:** Two distinct problems. (a) The catch-all at `src/agent.ts:178-181` discards the error object — an OpenAI auth failure, a bug in `runTool`, and a malformed tool-arg JSON all collapse into the same `console.warn` string with zero diagnostics. (b) The second completion call omits the `tools` parameter, so the model cannot chain calls (e.g. `get_rebooking_opportunities` → `draft_follow_up` for "draft a message for my most overdue VIP" requires two rounds; today the model must guess a customerId in round one or fail).
- **Fix specification:**
  1. Log the actual error: `console.warn("OpenAI request failed; using fallback:", error)`.
  2. Replace the two hardcoded calls with a bounded loop (max 4 iterations): call completions with `tools` each round; while the response contains `tool_calls`, execute them (each `runTool` in its own try/catch — on failure append a tool message `{"error": "<message>"}` instead of throwing, so the model can recover or apologize); when a round has no tool calls, return its content.
  3. Keep the outer catch → deterministic fallback as the last resort.

### G-07 · Bug · AI tool arguments are trusted without validation
- ✅ Fixed 2026-07-13: zod schemas per tool in `src/agent.ts` — `priority` coerced case-insensitively, `limit` clamped to 1–25 (default 8), `minDays*` non-negative; unknown `customerId` returns an `{error}` tool result (not a throw) so the model can recover. Parse failures return the zod message as the tool result.
- **Location:** `src/agent.ts:112-131` (`runTool`)
- **What happens:** Raw model-generated JSON is cast and passed straight into the domain layer. `priority: "high"` (wrong case) silently matches nothing; `limit: 100000` is honored; a fabricated `customerId` throws, which today (pre-G-06) aborts the whole AI path to fallback — the user gets a generic answer unrelated to what they asked.
- **Fix specification:** Define zod schemas per tool (zod is already a dependency):
  - `get_rebooking_opportunities`: coerce `priority` case-insensitively into `"High" | "Medium" | "Low"`; clamp `limit` to 1–25 (default 8); `minDays*` must be non-negative numbers.
  - `draft_follow_up`: `customerId` required string; on unknown customer return `{ error: "No customer with id ..." }` (a tool *result*, not a throw) so the model can respond gracefully.
  Parse with `schema.safeParse`; on failure return `{ error: <zod message> }` as the tool result.

### G-08 · Bug · Contact log records a placeholder instead of the actual message
- **Location:** `src/app.ts:154`, `src/relayops.ts:54-59`
- **What happens:** `markCustomerContacted(action.value, "Contacted from Slack action")` stores that literal string in `outreach_logs.message`. The draft the staff member actually saw (from `outreachDraftBlocks`) is never persisted. Channel is also assumed to be `recommendedChannel`, which recomputes and may differ from what was shown.
- **Fix specification:** When building `outreachDraftBlocks`, persist the draft first via `recordOutreach(customer.id, channel, message, "drafted")` and put the generated log id (or the customer id + drafted flag) in the button `value`. On *Mark contacted*, update that log row's status to `"contacted"` (add `updateOutreachStatus(id, status)` in `db.ts`) rather than inserting a placeholder. If the click comes from the daily report (no prior draft), keep the current insert but with message `"Marked contacted from daily report"` and the acting user (S-01).

### G-09 · Bug · Button failures are invisible to the user
- ✅ Fixed 2026-07-09: both action handlers now call `notifyStale(respond)` on error — an ephemeral "couldn't find that customer anymore, run /relayops scan" — itself guarded so a failed respond can't rethrow.
- **Location:** `src/app.ts:132-162` (both `catch (error) { logger.error(error) }` blocks)
- **What happens:** If `outreachDraftBlocks` throws (e.g. stale button referencing a re-seeded, now-nonexistent customer id) or `markCustomerContacted` throws, the error is logged server-side and the user sees a button that does nothing.
- **Failure scenario:** `npm run seed` re-runs while an old report is still in a channel; every button on the old report silently no-ops.
- **Fix specification:** In each catch, `await respond({ response_type: "ephemeral", text: "Sorry — I couldn't find that customer anymore. Run /relayops scan for a fresh report." })`, itself wrapped so a failed respond can't rethrow.

### G-10 · Bug · Foreign keys are declared but not enforced
- ✅ Fixed 2026-07-13: `db.pragma("foreign_keys = ON")` set in `getDb()` after the WAL pragma; `resetDemoData()` deletion order (`outreach_logs → appointments → customers`) verified child-first.
- **Location:** `src/db.ts:14-17`
- **What happens:** SQLite ignores `REFERENCES` constraints unless `PRAGMA foreign_keys = ON` is set per connection; only `journal_mode = WAL` is set. Orphaned `appointments`/`outreach_logs` rows are currently possible.
- **Fix specification:** Add `db.pragma("foreign_keys = ON");` immediately after the WAL pragma in `getDb()`. Then fix the latent ordering bug it exposes: `resetDemoData()` (`src/db.ts:175-178`) already deletes children before parents — verify the deletion order stays `outreach_logs, appointments, customers`.

### G-11 · Tech debt · Every lookup loads and scores the entire customer table
- **Location:** `src/db.ts:102-136` (`listCustomerRecords`, `getCustomerRecord`), all callers in `src/relayops.ts`
- **What happens:** `getCustomerRecord(id)` runs the full join over all customers and `.find()`s in JS. Every question, button click, and draft re-reads and re-scores everything. Fine at 100 demo customers; unusable at a 50k-customer tenant, and it blocks the PostgreSQL migration (the repository interface bakes in "fetch all".)
- **Fix specification (do before M2, not urgent now):** Add a real `WHERE c.id = ?` single-customer query for `getCustomerRecord`; add SQL-level filtering/limit for the common opportunity path. Keep function signatures stable so `relayops.ts` doesn't change.

### S-03 · Compliance · Consent is a score penalty, not a gate — and phone is assumed consent-free
- **Location:** `src/scoring.ts:18` (`consentSignal = -12`), `src/scoring.ts:25` (`recommendedChannel = ... : "phone"`)
- **What happens:** Customers with `marketing_consent = 0` are still ranked, displayed, and routed to phone outreach. Under CASL (the default timezone is America/Toronto) and TCPA, marketing calls to non-consenting customers are themselves regulated; "no consent → cold-call them instead" is not a safe default. Nothing implements opt-out at all.
- **Fix specification:** (1) Add `excludeNoConsent?: boolean` filter defaulting to `false` now, and decide the default with product before any pilot. (2) Change the recommendation copy for non-consenting customers from a phone *sales* script to "review consent status before outreach". (3) M2: add a suppression/opt-out table checked as a hard gate in `getOpportunities` and `createOutreachDraft`.

---

## Low

### G-12 · Bug · Deterministic parser matches keywords too loosely
- **Location:** `src/agent.ts:36-66`
- `"high"` matches "highlight", `"90"` matches any number containing 90, `"contact"` also matches "contacted". Acceptable for demo. Fix when touched: word-boundary regexes (`/\bhigh\b/`, `/\b90\b/`) and an ordered intent list.

### G-13 · Bug · Day boundaries use UTC while the business runs in `TIMEZONE`
- ✅ Fixed 2026-07-13: `todayIso()` now derives the date via `Intl.DateTimeFormat("en-CA", { timeZone: config.timezone })`. Pinned by `test/utils.test.ts`.
- **Location:** `src/utils.ts:17-25` (`todayIso`), `src/scoring.ts:56`
- After ~19:00 in Toronto, `todayIso()` returns tomorrow's date: `daysSinceLastVisit` inflates by one and the report header shows the wrong date. Cosmetic at day granularity. Fix when touched: derive "today" via `Intl.DateTimeFormat("en-CA", { timeZone: config.timezone })`.

### G-14 · Bug · `DATABASE_URL` accepts any string as a SQLite path
- **Location:** `src/db.ts:11`, `src/config.ts:7`
- A `postgres://...` URL would be opened as a literal SQLite file. Fix: in `config.ts`, refine the zod field to reject strings matching `/^(postgres|mysql):/` with a clear error naming the PostgreSQL upgrade path.

### G-15 · Design decision needed · Customers with no completed appointments are invisible
- **Location:** `src/db.ts:112-119` (INNER JOIN on latest completed appointment)
- A customer whose only visits were cancelled/no-show never appears anywhere. Defensible (no return cycle to measure) but undocumented and it hides no-show recovery — arguably the *most* valuable outreach segment. Decision for M2; documented as an edge case in `CLAUDE.md` §7.

### G-16 · Tech debt · View layer calls the service layer
- ✅ Fixed 2026-07-09: `outreachDraftBlocks` now takes `{ customer, message }`; `app.ts` builds the draft via `createOutreachDraft` and passes it in. `slackBlocks.ts` no longer imports the service layer. New `homeDashboardBlocks` follows the same pure-function pattern.
- **Location:** `src/slackBlocks.ts:3,87` — `outreachDraftBlocks` calls `createOutreachDraft`.
- Blocks builders should be pure functions of data. Fix opportunistically (it must change anyway for G-08): have `app.ts` create the draft and pass `{ customer, message }` in.

### G-17 · Hygiene · Placeholder URLs in `manifest.json`
- **Location:** `manifest.json:23,44,48` (`https://example.ngrok-free.app/...`)
- Harmless while `socket_mode_enabled: true` (Slack ignores request URLs), but confusing. Add a README note; replace only for the HTTP install flow.

### S-04 · Security · Prompt injection surface (accepted risk for now)
- **Location:** `src/agent.ts:133-150` — raw Slack text becomes the user message for a tool-bearing model.
- Blast radius is low: all three tools are read-only over data the workspace can already see, and nothing sends outbound messages. Risk grows the moment a "send outreach" tool exists — record here so that future feature adds an approval step and treats customer `notes` (which flow into tool results) as untrusted content.

### S-02 · Hygiene · Binary artifacts committed to git; local `.env` caution
- **Location:** `relayops-ai-rebooking-agent-submission.zip`, `RelayOps_AI_Rebooking_Agent_Pitch_Deck.pptx` (tracked); `.env` (untracked, correctly gitignored)
- The zip was audited 2026-07-06: it contains only source, docs, and `.env.example` — **no secrets, no database**. Keep it that way: never regenerate the zip with `zip -r . ` from a dirty working tree. The local `.env` holds real tokens; it stays untracked.

---

## Missing features (roadmap, not defects)

Tracked here for completeness; scheduling lives in [`PROJECT_OVERVIEW.md` §7](PROJECT_OVERVIEW.md).

| ID | Feature | Milestone | Notes |
|---|---|---|---|
| MF-01 | Contact suppression window + snooze action | M1 | Core of G-01; snooze = log row with status `snoozed` and a `resume_at` |
| MF-02 | Real data ingestion (CSV import → Square/Fresha connector) | M2 | Replaces `demoData.ts` for pilots; keep seeder for tests |
| MF-03 | Outcome tracking (did they rebook?) feeding likelihood model | M2 | Join outreach_logs to subsequent appointments |
| MF-04 | Opt-out / suppression list as hard gate | M2 | Pairs with S-03 |
| MF-05 | App Home tab + report pagination (beyond top 5) | M2 | ✅ App Home tab shipped 2026-07-09 (`homeDashboardBlocks`, `app_home_opened`/`refresh_home` handlers, `home_tab_enabled: true`). Pagination beyond top 5 still pending. |
| MF-06 | Audit log (who clicked what, which drafts were AI-generated) | M2/M3 | Extends S-01 fix |
| MF-07 | Multi-tenant isolation + OAuth install flow | M3 | Socket Mode is single-workspace |
| MF-08 | RAG over notes/playbooks/campaign history | M3 | Needs vector store; out of scope until M3 |
| MF-09 | MCP server exposing the service layer | M1 | ✅ Shipped 2026-07-09 (`src/mcp/server.ts`, `scripts/mcp.ts`, `npm run mcp`). Five tools over stdio; satisfies the Slack Challenge required-tech. Human-in-the-loop preserved (no send tool). |

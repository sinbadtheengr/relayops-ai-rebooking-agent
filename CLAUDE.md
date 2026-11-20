# RelayOps engineering guide

The [pilot runbook](README.md) defines the current CSV contract, approval workflow, consent rules, reporting windows and operational commands. The design and submission materials under `docs/` describe the earlier hackathon demo.

- `src/db.ts` owns SQLite and transaction boundaries. A process serves one configured client. Business mutations and their success audits commit together. Rejected actions are recorded after rollback.
- `src/importCsv.ts` parses and validates the sole booking input. Preserve immutable export versions, stable external IDs, idempotent retries and sticky withdrawals.
- `src/eligibility.ts` computes consent, cooldown, scheduled visits and handoff eligibility from a point-in-time snapshot. `src/relayops.ts` applies the same gates at each staff transition.
- `src/outreach.ts` renders the versioned text reviewed and sent. Update the template version when changing that copy. Use persisted messages for audit and staff delivery.
- `src/staff.ts` and `src/app.ts` implement authorized staff commands. The agent and MCP expose drafts for review. Approval, handoff and confirmation belong to staff.
- `src/weekly.ts` calculates the seven pilot measures. `src/scheduler.ts` generates and optionally posts the weekly totals.
- Run `npm run build` and `npm test`. Tests use synthetic booking exports, isolated disk directories, controlled clocks and mocked Slack. The CLI concurrency test starts real processes against the same client database.

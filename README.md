# RelayOps med-spa pilot

RelayOps imports the spa’s booking CSV, finds overdue clients who can be contacted, and gives staff a private approval workflow in Slack. Staff deliver the approved copy through the spa’s existing email or SMS account and confirm the send. Booking and revenue outcomes come from subsequent booking exports.

## Set up one client

1. Install Node.js 22 LTS and run `npm ci`, `npm run build` and `npm test`.
2. Use the settings in [.env.example](.env.example) to configure the deployment. Give the spa a stable lowercase `RELAYOPS_CLIENT_ID`, its business timezone and a dedicated `RELAYOPS_DATA_DIR` on persistent local storage. Configure the business name used when collecting consent, full mailing address and monitored contact email. The spa sends on its own behalf.
3. Use one Slack workspace and app process per spa. Install the [Socket Mode manifest](manifest.json), supply its three Slack credentials, set `SLACK_TEAM_ID` to the workspace ID and list the individual authorized Slack users in `RELAYOPS_STAFF_IDS`. Use individual OS accounts for CLI operators as their usernames appear in the audit. Limit access to the data directory, booking files, backups and local MCP process to this spa’s operators.
4. Map the spa’s export to the columns below. Verify the source records for its consent evidence, confirm that both email and SMS recipients can reply to unsubscribe at no cost on the accounts staff use, and identify the staff member monitoring incoming requests.
5. Import the CSV, run a scan, then start the Slack process. Keep the process running for scheduled reports. The CLI works offline.

```powershell
npm run import:csv -- north-spa "D:\secure\north-spa\bookings.csv" "2026-11-19T18:00:00-05:00"
npm run scan
npm start
```

Set the example client slug to the same value in the environment and command. The third import argument is the timestamp of the export. Each client begins with an empty database. The legacy demo database and archived hackathon materials are separate from the pilot. Local Q&A uses templates by default. Enable the existing optional OpenAI Q&A only if the spa authorizes sending question and tool data to that service.

## CSV contract

Use UTF-8 with a header and one row per booking. Quoted commas, escaped double quotes, line breaks, Windows line endings and a UTF-8 BOM are supported. The importer ignores extra columns. Exclude clinical notes. An example row with fictional data follows.

```csv
client_id,customer_id,full_name,preferred_channel,email,phone,typical_return_days,vip,appointment_id,service_type,service_date,status,revenue_cents,booked_at,consent_basis,consent_at,consent_evidence,opted_out_at
north-spa,C101,Avery Example,email,avery@example.test,,60,false,B501,Return visit,2026-08-03,completed,12500,2026-07-27T15:00:00Z,express,2026-07-27T15:05:00Z,Reception opt-in form F19 for rebooking emails,
```

| Fields | Meaning |
| --- | --- |
| `customer_id`, `appointment_id` | Required stable IDs from the booking system. Each booking belongs to one customer for its lifetime. |
| `full_name`, `preferred_channel`, `typical_return_days` | Required customer profile. Channel accepts `email`, `sms` or `phone`. The rebooking cycle is a positive whole number of days. A phone-call preference stays outside electronic outreach. |
| `email`, `phone`, `vip` | Include a valid destination for the chosen channel. Canadian 10-digit numbers normalize to +1. Use international format for other SMS numbers. VIP accepts `true`, `false` or blank. |
| `service_type`, `service_date`, `status`, `revenue_cents` | Required. Date is the local service day in YYYY-MM-DD. Status accepts `scheduled`, `completed`, `cancelled` or `no_show`. Supply nonnegative integer CAD cents. For completed visits use actual collected service revenue net of refunds. |
| `booked_at` | Actual booking creation timestamp with timezone. A blank value excludes the booking from attribution while preserving visit history. |
| `consent_basis`, `consent_at`, `consent_evidence` | Supply `express`, `implied_purchase` or `implied_inquiry` with a dated basis and evidence reference. The evidence must identify how this spa can send rebooking messages to this specific destination. For implied consent, supply the qualifying transaction or inquiry time and its source record. Blank or `none` suppresses outreach. |
| `opted_out_at` | Actual withdrawal timestamp with timezone. Import applies it immediately and retains it across later imports. |
| `client_id` | Optional per-row spa slug. When present, every row must match the configured client and command argument. |

For all rows sharing a customer ID, repeat the same current profile and consent fields. A malformed row or conflicting duplicate rejects the entire file. The importer records the file’s SHA-256 digest, export time, load time and operator. Replaying the same file and export timestamp is idempotent. Later exports update matching IDs and preserve history. Omitted bookings retain their last status, so include explicit cancellations, no-shows and corrections. Import fresh exports before staff start outreach.

## Staff delivery and withdrawals

| Staff action | Slack command |
| --- | --- |
| View private opportunities | `/relayops scan` |
| Review the exact message | Click **Draft outreach** or use `/relayops draft CUSTOMER_ID`. |
| Approve | Click **Approve this text** or use `/relayops approve MESSAGE_ID` after review. |
| Claim a delivery | Immediately before sending, check the monitored inbox for withdrawals and run `/relayops deliver MESSAGE_ID`. The command rechecks eligibility and shows the destination and approved copy. |
| Confirm a manual send | Send the exact text once through the spa’s existing account. Run `/relayops sent MESSAGE_ID` immediately. For a delayed entry, append the actual ISO delivery timestamp. |
| Close an unsent draft | `/relayops cancel MESSAGE_ID`. Only the staff member holding a delivery can release that hold. After a crash, verify the spa’s sent history before resuming. |
| Log an inbound reply | `/relayops reply MESSAGE_ID reply INBOX_REFERENCE RECEIVED_AT`. Use a stable, client-wide reference such as a mailbox name plus its message ID. |
| Log an unsubscribe reply | `/relayops reply MESSAGE_ID optout INBOX_REFERENCE RECEIVED_AT`. This records the reply and withdrawal together. |
| Record a withdrawal through any other route | `/relayops optout CUSTOMER_ID RECEIVED_AT SOURCE`, for example `/relayops optout C101 2026-11-19T20:15:00Z verbal request at reception`. |

Process every withdrawal immediately, including requests expressed in the recipient’s own words. Staff classify replies in the monitored inbox. Keep the contact information and unsubscribe mechanism valid for at least 60 days after sending. CASL requires processing requests without delay and within 10 business days. Keep the underlying forms, receipts or inquiry records referenced by the export with the spa’s controlled records. [CRTC guidance on consent and records](https://crtc.gc.ca/eng/com500/guide.htm) · [CRTC identification and unsubscribe FAQ](https://crtc.gc.ca/eng/com500/faq500.htm)

An overdue customer needs a completed visit, a gap greater than their return cycle and no scheduled visit today or later. Outreach also requires evidence, a usable destination and an available recipient. A withdrawal suppresses the customer and matched destinations across imports. The pilot keeps withdrawals in force. Express consent has no expiry while valid. Purchase and inquiry consent expire at the start of the local anniversary day after 24 and 6 calendar months respectively. A confirmed send starts a 14-day cooldown.

The store keeps the draft body, template version, SHA-256 text hash, destination, business identity and consent evidence. Staff approval, delivery handoff and send confirmation each record the actor, timestamp and checked consent and suppression state. Profile or copy changes require fresh review. The sender’s handoff survives a restart and prevents a competing claim.

## Weekly recovery report

Run `npm run weekly` or `/relayops weekly` for the last complete Monday–Sunday week. Append a local Monday such as `2026-11-16` to choose another week. The current week shows progress to date. The running app generates the previous week’s report every Monday at 08:00 in the configured timezone and retains the result in the audit log. Setting `SLACK_REPORT_CHANNEL_ID` also posts the totals to the existing staff channel. Run the CLI for a missed week after downtime.

| Measure | Counting rule |
| --- | --- |
| Overdue clients | Distinct overdue customers at week end, reconstructed from export versions. |
| Clients we can contact | The overdue subset with eligible consent and destination, after withdrawals, active handoffs and cooldowns. |
| Drafts approved | First staff approval for each draft during the week. |
| Messages sent | Staff-confirmed manual deliveries by actual send time. |
| Replies | Distinct recorded inbound references by received time, including unsubscribe replies. |
| Bookings | Distinct active or completed appointments created strictly after a confirmed send to that customer and within 30 days of it, counted in the booking creation week. |
| Recovered revenue | Actual collected cents on those attributed completed appointments, counted in their service week. |

The 30-day window is the pilot’s attribution assumption. A booking counts once even when more than one send qualifies. Cancellations and corrections in later exports can revise historical totals. Each generation retains the figures shown at that time. Daily scoring estimates are separate from weekly collected revenue.

## Records and backup

```powershell
npm run pilot -- record MESSAGE_ID
npm run pilot -- audit
```

The same trusted CLI supports the staff verbs in the table. Slack actors are identified by user ID inside the bound workspace. CLI actors are identified by OS login. The local MCP tools can read opportunities and create drafts for review.

Each client has a SQLite file named `client-CLIENT_ID.sqlite` with WAL journaling, transactions, foreign keys and append-only record history. The database binds the client ID, timezone, configured sender name and Slack workspace. Use an encrypted persistent disk and separate OS permissions for each deployment. Store exports and backups outside source control.

For a live backup, use SQLite’s online backup command on the client database, for example `sqlite3 client-north-spa.sqlite ".backup north-spa-backup.sqlite"` from its data directory. Move the backup to the spa’s protected backup location. To verify recovery, restore the backup under the original database filename in a separate directory, point a CLI process at that directory with the same client settings, run `PRAGMA integrity_check` with SQLite, and compare a known message record and weekly report. Keep audit, proof and source records according to the spa’s retention policy.

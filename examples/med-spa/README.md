# Juniper Cove staff walkthrough

From the root of the `codex/med-spa-demo` checkout, run the following command with Node.js 22 LTS and npm installed.

```sh
npm run demo:medspa
```

The command installs the locked dependencies and runs the pilot locally against a fresh SQLite database. It advances a demo clock through November 2026. The staff actions use your local operator identity. Delivery confirmations and replies are simulated. All times below are Toronto local time.

## At the front desk

1. **Open the queue.** On November 2, the [opening export](01-opening.csv) brings in four overdue customers. Avery, Morgan and Casey are eligible. Rowan has no recorded consent basis.
2. **Review Avery’s email.** The draft shows the exact copy, template version and signed email opt-in `F-104`. At 9:03 the operator tries `deliver` before approval and sees “Staff approval is required before delivery.” At 9:04 the operator runs `approve` on that draft ID, claims it with `deliver` at 9:05 and records the simulated manual send with `sent` at 9:06.
3. **Record the two replies.** Morgan’s SMS uses purchase receipt `R-208` as consent evidence and goes through the same approval steps. Avery replies at 9:30. Morgan requests an unsubscribe at 9:35. The operator records it at 9:36 with inbox reference `desk-sms-208`. The withdrawal is linked to Morgan’s phone number and message ID.
4. **Reconcile Avery’s booking.** In the [second export](02-booked.csv), appointment `B-2041` was booked at 10:15, after Avery’s confirmed send. The interim report shows one attributed booking and CAD $0.00 collected. In the [third export](03-completed.csv), the same appointment is completed on November 6 with `revenue_cents=18500`.
5. **Check suppression.** On November 20 the operator asks for another draft for Morgan. Both later exports carried the original purchase evidence and the 14-day cooldown has elapsed. The pilot still blocks outreach because the withdrawal remains on file.

## Weekly recovery · November 2–8

| Measure | Expected |
| --- | ---: |
| Overdue customers | 3 |
| Customers staff can contact | 1 |
| Drafts approved | 2 |
| Messages confirmed sent | 2 |
| Replies, including Morgan’s opt-out | 2 |
| Attributed bookings | 1 |
| Recovered revenue | **CAD $185.00** |

Casey is the remaining eligible customer. Avery has returned, Morgan has withdrawn and Rowan still lacks consent.

The terminal prints the temporary output directory for each run. Open `avery-message.json` for the approved email, consent checks, actor and timestamps. Open `morgan-message.json` for the original SMS and its withdrawal record. The same directory contains `audit-log.json`, `weekly-recovery.txt` and the client database.

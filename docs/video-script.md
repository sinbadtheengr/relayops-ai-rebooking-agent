# 3-Minute Demo Video Script

Target: ~3:00. Runs credential-free (no OpenAI key needed).

## 0:00–0:20 Problem

Appointment-based small businesses — salons, dental clinics, physio, home services — already paid to acquire their customers. The revenue they quietly lose is the customer who never rebooks, because nobody on staff owns the job of noticing. RelayOps is a Slack-native AI agent that finds that missed revenue every morning and helps staff recover it.

## 0:20–0:45 Daily Scan

Run `/relayops scan`. RelayOps posts a Block Kit report: overdue customers, high-priority opportunities, and estimated recoverable revenue. Each customer shows why it was selected, days overdue, rebooking likelihood, best channel, and recovery value — all from booking and CRM data.

## 0:45–1:10 Grounded, Conversational AI

DM the app: `Who has not returned in 90 days?` then `Show overdue VIP customers.` RelayOps answers from structured tools, not generic chatbot memory. Note the streaming response and the "Checking CRM records…" thinking status — Slack's AI-app surface.

## 1:10–1:35 Draft + Close the Loop

Click `Draft outreach` — a personalized SMS/email/phone script using the customer's last service, channel preference, and consent. Click `Mark contacted`. Re-run `/relayops scan`: that customer is **gone**, and the report notes they were suppressed. RelayOps keeps the promise its report makes — no double-contacting, no spammed customers. Humans stay in the loop: it drafts, staff send.

## 1:35–2:05 App Home Dashboard

Open the RelayOps **App Home** tab: live KPIs — recoverable revenue, overdue count, high-priority, already-contacted — and the top opportunities with action buttons, right where staff already work.

## 2:05–2:40 MCP Server (the required-technology highlight)

Switch to Claude Desktop, where RelayOps is configured as an **MCP server**. Ask: `Summarize today's RelayOps rebooking opportunities` and `Draft a follow-up for the most overdue VIP.` The same grounded intelligence that powers Slack is now callable from any MCP client — because both adapters share one domain core. Human-in-the-loop is preserved: the MCP tools draft and log, never send.

## 2:40–3:00 Close

RelayOps starts with SQLite and demo data, but the architecture is production-shaped: a single SQL module swaps to PostgreSQL, booking connectors and CSV import feed real data, and consent enforcement gates outreach. One clean domain core, a Slack agent and an MCP server on top — a practical AI product that recovers revenue businesses already earned.

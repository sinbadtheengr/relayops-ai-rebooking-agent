import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { CommunicationChannel, Customer, CustomerRecord } from "./types.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = config.databaseUrl.replace(/^sqlite:\/\//, "");
  const dir = path.dirname(dbPath);
  if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

export function migrate(database = getDb()): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      business_type TEXT NOT NULL,
      preferred_channel TEXT NOT NULL,
      vip INTEGER NOT NULL,
      typical_return_days INTEGER NOT NULL,
      total_spend_cents INTEGER NOT NULL,
      average_ticket_cents INTEGER NOT NULL,
      marketing_consent INTEGER NOT NULL,
      notes TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      service_type TEXT NOT NULL,
      service_date TEXT NOT NULL,
      revenue_cents INTEGER NOT NULL,
      staff_member TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outreach_logs (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL REFERENCES customers(id),
      channel TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_appointments_customer_date ON appointments(customer_id, service_date DESC);
    CREATE INDEX IF NOT EXISTS idx_outreach_customer_date ON outreach_logs(customer_id, created_at DESC);
  `);
}

interface CustomerRow {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  business_type: string;
  preferred_channel: CommunicationChannel;
  vip: 0 | 1;
  typical_return_days: number;
  total_spend_cents: number;
  average_ticket_cents: number;
  marketing_consent: 0 | 1;
  notes: string;
  created_at: string;
}

interface CustomerRecordRow extends CustomerRow {
  last_visit_date: string;
  last_service_type: string;
  appointment_count: number;
}

function mapCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    businessType: row.business_type,
    preferredChannel: row.preferred_channel,
    vip: row.vip === 1,
    typicalReturnDays: row.typical_return_days,
    totalSpendCents: row.total_spend_cents,
    averageTicketCents: row.average_ticket_cents,
    marketingConsent: row.marketing_consent === 1,
    notes: row.notes,
    createdAt: row.created_at
  };
}

export function listCustomerRecords(): CustomerRecord[] {
  const rows = getDb()
    .prepare(
      `
      SELECT
        c.*,
        latest.service_date AS last_visit_date,
        latest.service_type AS last_service_type,
        COUNT(a.id) AS appointment_count
      FROM customers c
      JOIN appointments latest
        ON latest.id = (
          SELECT id FROM appointments
          WHERE customer_id = c.id AND status = 'completed'
          ORDER BY service_date DESC
          LIMIT 1
        )
      JOIN appointments a ON a.customer_id = c.id AND a.status = 'completed'
      GROUP BY c.id
      ORDER BY latest.service_date ASC
      `
    )
    .all() as CustomerRecordRow[];

  return rows.map((row) => ({
    ...mapCustomer(row),
    lastVisitDate: row.last_visit_date,
    lastServiceType: row.last_service_type,
    appointmentCount: row.appointment_count
  }));
}

export function getCustomerRecord(customerId: string): CustomerRecord | undefined {
  return listCustomerRecords().find((customer) => customer.id === customerId);
}

export function insertCustomer(customer: Customer): void {
  getDb()
    .prepare(
      `
      INSERT INTO customers (
        id, full_name, email, phone, business_type, preferred_channel, vip,
        typical_return_days, total_spend_cents, average_ticket_cents,
        marketing_consent, notes, created_at
      ) VALUES (
        @id, @fullName, @email, @phone, @businessType, @preferredChannel, @vip,
        @typicalReturnDays, @totalSpendCents, @averageTicketCents,
        @marketingConsent, @notes, @createdAt
      )
      `
    )
    .run({ ...customer, vip: customer.vip ? 1 : 0, marketingConsent: customer.marketingConsent ? 1 : 0 });
}

export function insertAppointment(input: {
  id: string;
  customerId: string;
  serviceType: string;
  serviceDate: string;
  revenueCents: number;
  staffMember: string;
  status: "completed" | "cancelled" | "no_show";
}): void {
  getDb()
    .prepare(
      `
      INSERT INTO appointments (id, customer_id, service_type, service_date, revenue_cents, staff_member, status)
      VALUES (@id, @customerId, @serviceType, @serviceDate, @revenueCents, @staffMember, @status)
      `
    )
    .run(input);
}

export function resetDemoData(): void {
  const database = getDb();
  database.exec("DELETE FROM outreach_logs; DELETE FROM appointments; DELETE FROM customers;");
}

export function recordOutreach(customerId: string, channel: string, message: string, status: string): void {
  getDb()
    .prepare(
      `
      INSERT INTO outreach_logs (id, customer_id, channel, message, status, created_at)
      VALUES (@id, @customerId, @channel, @message, @status, @createdAt)
      `
    )
    .run({
      id: `out_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      customerId,
      channel,
      message,
      status,
      createdAt: new Date().toISOString()
    });
}


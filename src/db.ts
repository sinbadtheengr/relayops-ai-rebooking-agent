import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { actorId } from "./actor.js";
import { config } from "./config.js";
import type { Booking, Profile, parseExport } from "./importCsv.js";

let connection: Database.Database | undefined;

export function getDb() {
  if (connection) return connection;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(config.clientId))
    throw new Error("Set RELAYOPS_CLIENT_ID to a lowercase client slug.");
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  const db = new Database(path.resolve(config.dataDir, "client-" + config.clientId + ".sqlite"));
  try {
    db.pragma("foreign_keys = ON");
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = FULL");
    db.transaction(() => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").pluck().all();
      if (tables.length && !tables.includes("client_settings"))
        throw new Error("Unrecognized database. Use a dedicated pilot directory.");
      db.exec(`
        CREATE TABLE IF NOT EXISTS client_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS imports(id INTEGER PRIMARY KEY, as_of TEXT UNIQUE NOT NULL, digest TEXT NOT NULL,
          loaded_at TEXT NOT NULL, actor TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS profiles(id TEXT NOT NULL, batch INTEGER NOT NULL REFERENCES imports, body TEXT NOT NULL,
          PRIMARY KEY(id,batch));
        CREATE TABLE IF NOT EXISTS bookings(id TEXT NOT NULL, batch INTEGER NOT NULL REFERENCES imports, body TEXT NOT NULL,
          PRIMARY KEY(id,batch));
        CREATE TABLE IF NOT EXISTS withdrawals(id INTEGER PRIMARY KEY, customer TEXT NOT NULL, email TEXT NOT NULL,
          phone TEXT NOT NULL, effective_at TEXT NOT NULL, recorded_at TEXT NOT NULL, actor TEXT NOT NULL, source TEXT NOT NULL,
          message_id TEXT REFERENCES messages, UNIQUE(customer,email,phone,effective_at,source));
        CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, customer TEXT NOT NULL, channel TEXT NOT NULL,
          destination TEXT NOT NULL, body TEXT NOT NULL, template TEXT NOT NULL, hash TEXT NOT NULL, sender TEXT NOT NULL,
          created_at TEXT NOT NULL, creator TEXT NOT NULL, evidence TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS message_events(message_id TEXT NOT NULL REFERENCES messages, kind TEXT NOT NULL,
          at TEXT NOT NULL, actor TEXT NOT NULL, evidence TEXT NOT NULL, PRIMARY KEY(message_id,kind));
        CREATE INDEX IF NOT EXISTS event_times ON message_events(kind,at);
        CREATE TABLE IF NOT EXISTS replies(reference TEXT NOT NULL, message_id TEXT NOT NULL REFERENCES messages,
          received_at TEXT NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY(message_id,reference));
        CREATE UNIQUE INDEX IF NOT EXISTS reply_reference ON replies(reference);
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
          target TEXT NOT NULL, outcome TEXT NOT NULL, detail TEXT NOT NULL);
      `);
      for (const table of [
        "imports",
        "profiles",
        "bookings",
        "messages",
        "message_events",
        "withdrawals",
        "replies",
        "audit",
        "client_settings"
      ]) {
        for (const op of ["UPDATE", "DELETE"]) {
          db.exec(`CREATE TRIGGER IF NOT EXISTS immutable_${table}_${op} BEFORE ${op} ON ${table}
            BEGIN SELECT RAISE(ABORT,'Pilot records are append-only'); END;`);
        }
      }
      bind(db, "client", config.clientId);
      bind(db, "timezone", config.timezone);
      if (config.senderName) bind(db, "sender", config.senderName);
      if (config.teamId) bind(db, "slack_team", config.teamId);
    }).immediate();
    connection = db;
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function bind(db: Database.Database, key: string, value: string) {
  db.prepare("INSERT INTO client_settings VALUES (?,?) ON CONFLICT(key) DO NOTHING").run(key, value);
  if (db.prepare("SELECT value FROM client_settings WHERE key=?").pluck().get(key) !== value) {
    throw new Error("Pilot database identity or timezone mismatch.");
  }
}

export function closeDb() {
  connection?.close();
  connection = undefined;
}

export function audit(action: string, target = "", outcome = "ok", detail = "") {
  getDb()
    .prepare("INSERT INTO audit(at,actor,action,target,outcome,detail) VALUES (?,?,?,?,?,?)")
    .run(new Date().toISOString(), actorId(), action, target, outcome, detail);
}

// The success log commits with the work. Failures roll back first, then record the rejection.
export function action<T>(name: string, target: string, work: () => T): T {
  try {
    return getDb()
      .transaction(() => {
        const result = work();
        audit(name, target);
        return result;
      })
      .immediate();
  } catch (error) {
    audit(name, target, "failed", (error as Error).message);
    throw error;
  }
}

export function auditTrail() {
  return action("audit.read", "", () => getDb().prepare("SELECT * FROM audit ORDER BY id").all());
}

function versions<T>(table: "profiles" | "bookings", at: string): Array<{ batch: number; value: T }> {
  const rows = getDb()
    .prepare(
      `SELECT v.batch,v.body FROM ${table} v JOIN (
    SELECT ${table}.id,max(batch) batch FROM ${table} JOIN imports ON imports.id=${table}.batch
    WHERE imports.as_of <= ? GROUP BY ${table}.id
  ) latest ON latest.id=v.id AND latest.batch=v.batch`
    )
    .all(at) as { batch: number; body: string }[];
  return rows.map((r) => ({ batch: r.batch, value: JSON.parse(r.body) as T }));
}

export function loadState(at: string) {
  return {
    profiles: versions<Profile>("profiles", at),
    bookings: versions<Booking>("bookings", at).map((r) => r.value),
    withdrawals: getDb().prepare("SELECT * FROM withdrawals WHERE effective_at<=?").all(at) as Withdrawal[],
    holds: getDb()
      .prepare(
        `SELECT m.id,m.customer,m.destination,h.at FROM messages m JOIN message_events h
      ON h.message_id=m.id AND h.kind='released' AND h.at<=? WHERE NOT EXISTS
      (SELECT 1 FROM message_events e WHERE e.message_id=m.id AND e.kind IN ('sent','cancelled') AND e.at<=?)`
      )
      .all(at, at) as { id: string; customer: string; destination: string; at: string }[],
    sends: getDb()
      .prepare(
        `SELECT m.customer,m.destination,e.at FROM messages m JOIN message_events e
      ON m.id=e.message_id WHERE e.kind='sent' AND e.at<=?`
      )
      .all(at) as { customer: string; destination: string; at: string }[]
  };
}

export function saveExport(data: ReturnType<typeof parseExport>, asOf: string, digest: string) {
  const db = getDb();
  const last = db.prepare("SELECT id,as_of,digest FROM imports ORDER BY id DESC LIMIT 1").get() as
    | { id: number; as_of: string; digest: string }
    | undefined;
  const existing = db.prepare("SELECT id FROM imports WHERE as_of=? AND digest=?").pluck().get(asOf, digest);
  if (existing) return { batch: Number(existing), profiles: 0, bookings: 0, duplicate: true };
  if (last && asOf <= last.as_of) throw new Error("Export timestamp must be newer than the last accepted export.");
  const batch = Number(
    db
      .prepare("INSERT INTO imports(as_of,digest,loaded_at,actor) VALUES (?,?,?,?)")
      .run(asOf, digest, new Date().toISOString(), actorId()).lastInsertRowid
  );
  function save<T extends Profile | Booking>(table: "profiles" | "bookings", items: Map<string, T>) {
    const previous = db.prepare(`SELECT body FROM ${table} WHERE id=? ORDER BY batch DESC LIMIT 1`).pluck();
    const insert = db.prepare(`INSERT INTO ${table} VALUES (?,?,?)`);
    let count = 0;
    for (const item of items.values()) {
      const old = previous.get(item.id) as string | undefined;
      const body = JSON.stringify(item);
      if (old === body) continue;
      if ("customerId" in item && old && JSON.parse(old).customerId !== item.customerId)
        throw new Error("Booking ID belongs to another customer.");
      insert.run(item.id, batch, body);
      audit(table === "bookings" ? "booking.imported" : "profile.imported", item.id, "ok", String(batch));
      count++;
    }
    return count;
  }
  const profiles = save("profiles", data.profiles);
  const bookings = save("bookings", data.bookings);
  for (const [id, times] of data.withdrawals) {
    for (const at of times) withdraw(data.profiles.get(id)!, at, "csv", null);
  }
  return { batch, profiles, bookings, duplicate: false };
}

interface Withdrawal {
  customer: string;
  email: string;
  phone: string;
  effective_at: string;
}
export function withdraw(
  p: Pick<Profile, "id" | "email" | "phone">,
  at: string,
  source: string,
  messageId: string | null
) {
  const result = getDb()
    .prepare(
      `INSERT INTO withdrawals(customer,email,phone,effective_at,recorded_at,actor,source,message_id)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(customer,email,phone,effective_at,source) DO NOTHING`
    )
    .run(p.id, p.email, p.phone, at, new Date().toISOString(), actorId(), source, messageId);
  if (result.changes) audit("withdrawal.recorded", p.id, "ok", JSON.stringify({ at, source, messageId }));
}

export interface Message {
  id: string;
  customer: string;
  channel: string;
  destination: string;
  body: string;
  template: string;
  hash: string;
  sender: string;
  created_at: string;
  creator: string;
  evidence: string;
}
export function insertMessage(fields: Omit<Message, "id" | "created_at" | "creator">) {
  const row = { ...fields, id: randomUUID(), created_at: new Date().toISOString(), creator: actorId() };
  getDb()
    .prepare(
      `INSERT INTO messages VALUES (@id,@customer,@channel,@destination,@body,@template,@hash,@sender,@created_at,@creator,@evidence)`
    )
    .run(row);
  audit("message.created", row.id, "ok", row.customer);
  return row;
}
export function messageById(id: string) {
  const row = getDb().prepare("SELECT * FROM messages WHERE id=?").get(id) as Message | undefined;
  if (!row) throw new Error("Unknown message ID.");
  return row;
}
export type Stage = "approved" | "released" | "sent" | "cancelled";
export function eventFor(id: string, kind: Stage) {
  return getDb().prepare("SELECT * FROM message_events WHERE message_id=? AND kind=?").get(id, kind) as
    | { at: string; actor: string; evidence: string }
    | undefined;
}
export function addEvent(id: string, kind: Stage, evidence: string, at = new Date().toISOString()) {
  getDb().prepare("INSERT INTO message_events VALUES (?,?,?,?,?)").run(id, kind, at, actorId(), evidence);
}
export function addReply(id: string, reference: string, at: string, kind: string) {
  const db = getDb();
  const old = db.prepare("SELECT message_id,received_at,kind FROM replies WHERE reference=?").get(reference) as
    | { message_id: string; received_at: string; kind: string }
    | undefined;
  if (old) {
    if (old.message_id !== id || old.kind !== kind || old.received_at !== at)
      throw new Error("Reply reference already recorded with different details.");
    return;
  }
  db.prepare("INSERT INTO replies VALUES (?,?,?,?,?)").run(reference, id, at, actorId(), kind);
}
export function messageRecord(id: string) {
  return action("message.read", id, () => {
    const message = messageById(id);
    const evidence = JSON.parse(message.evidence);
    const consentImport = getDb().prepare("SELECT * FROM imports WHERE id=?").get(evidence.profileBatch);
    const events = getDb()
      .prepare("SELECT kind,at,actor,evidence FROM message_events WHERE message_id=? ORDER BY rowid")
      .all(id) as { kind: Stage; at: string; actor: string; evidence: string }[];
    return {
      message: { ...message, sender: JSON.parse(message.sender), evidence },
      consentImport,
      events: events.map((event) => ({ ...event, evidence: JSON.parse(event.evidence) })),
      replies: getDb().prepare("SELECT * FROM replies WHERE message_id=?").all(id),
      withdrawals: getDb()
        .prepare("SELECT * FROM withdrawals WHERE customer=? OR email=? OR phone=? ORDER BY effective_at")
        .all(message.customer, message.destination, message.destination)
    };
  });
}
export function countsBetween(start: string, end: string) {
  const db = getDb();
  const count = db.prepare("SELECT count(*) FROM message_events WHERE kind=? AND at>=? AND at<?").pluck();
  return {
    draftsApproved: Number(count.get("approved", start, end)),
    messagesSent: Number(count.get("sent", start, end)),
    replies: Number(
      db.prepare("SELECT count(*) FROM replies WHERE received_at>=? AND received_at<?").pluck().get(start, end)
    )
  };
}

import Database from "better-sqlite3";
import type { Database as SqliteDatabase } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const nowMsSql = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";

function resolveDatabasePath(): string {
  const explicitPath = process.env["SQLITE_DATABASE_PATH"];
  if (explicitPath) return path.resolve(process.cwd(), explicitPath);

  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl?.startsWith("file:")) {
    return path.resolve(process.cwd(), databaseUrl.slice("file:".length));
  }

  return path.resolve(process.cwd(), "../../data/sales-automation.sqlite");
}

export const databasePath = resolveDatabasePath();
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

export const sqlite: SqliteDatabase = new Database(databasePath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

sqlite.exec(`
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  from_name TEXT,
  reply_to TEXT,
  daily_limit INTEGER,
  batch_size INTEGER NOT NULL DEFAULT 25,
  batch_interval_minutes INTEGER NOT NULL DEFAULT 60,
  send_window_start TEXT NOT NULL DEFAULT '07:00',
  send_window_end TEXT NOT NULL DEFAULT '19:00',
  send_window_timezone TEXT NOT NULL DEFAULT 'Australia/Sydney',
  send_window_days TEXT NOT NULL DEFAULT 'mon,tue,wed,thu,fri',
  track_opens INTEGER NOT NULL DEFAULT 1,
  track_clicks INTEGER NOT NULL DEFAULT 1,
  include_unsubscribe INTEGER NOT NULL DEFAULT 1,
  leads_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  open_count INTEGER NOT NULL DEFAULT 0,
  click_count INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  bounce_count INTEGER NOT NULL DEFAULT 0,
  scheduled_start_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (${nowMsSql})
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  first_name TEXT,
  last_name TEXT,
  company TEXT,
  title TEXT,
  role_title TEXT,
  website TEXT,
  phone TEXT,
  linkedin_url TEXT,
  custom_fields_json TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL DEFAULT (${nowMsSql})
);

CREATE TABLE IF NOT EXISTS campaign_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (${nowMsSql}),
  UNIQUE(campaign_id, lead_id)
);

CREATE TABLE IF NOT EXISTS email_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'connected',
  warmup_enabled INTEGER NOT NULL DEFAULT 0,
  daily_send_limit INTEGER NOT NULL DEFAULT 50,
  sent_today INTEGER NOT NULL DEFAULT 0,
  sent_today_date TEXT,
  health_score INTEGER,
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_username TEXT,
  smtp_password_enc TEXT,
  imap_host TEXT,
  imap_port INTEGER,
  imap_last_uid INTEGER,
  last_polled_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL DEFAULT (${nowMsSql})
);

CREATE TABLE IF NOT EXISTS sequence_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  step_number INTEGER NOT NULL DEFAULT 1,
  subject TEXT NOT NULL,
  preview_text TEXT,
  body TEXT NOT NULL,
  body_type TEXT NOT NULL DEFAULT 'text',
  attachments_json TEXT,
  delay_days INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (${nowMsSql})
);

CREATE TABLE IF NOT EXISTS sequence_step_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step_id INTEGER NOT NULL,
  label_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  preview_text TEXT,
  body TEXT NOT NULL,
  body_type TEXT NOT NULL DEFAULT 'text',
  attachments_json TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (${nowMsSql}),
  UNIQUE(step_id, label_id)
);

CREATE TABLE IF NOT EXISTS inbox_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_email TEXT NOT NULL,
  from_name TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  is_archived INTEGER NOT NULL DEFAULT 0,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  sentiment TEXT,
  campaign_id INTEGER,
  lead_id INTEGER,
  received_at INTEGER NOT NULL DEFAULT (${nowMsSql})
);

CREATE TABLE IF NOT EXISTS daily_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  sent INTEGER NOT NULL DEFAULT 0,
  opened INTEGER NOT NULL DEFAULT 0,
  replied INTEGER NOT NULL DEFAULT 0,
  bounced INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (${nowMsSql})
);

CREATE TABLE IF NOT EXISTS email_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  preview_text TEXT,
  body TEXT NOT NULL,
  body_type TEXT NOT NULL DEFAULT 'text',
  attachments_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (${nowMsSql}),
  updated_at INTEGER NOT NULL DEFAULT (${nowMsSql})
);

CREATE TABLE IF NOT EXISTS lead_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_at INTEGER NOT NULL DEFAULT (${nowMsSql})
);

CREATE TABLE IF NOT EXISTS list_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  list_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (${nowMsSql}),
  UNIQUE(list_id, lead_id)
);

CREATE TABLE IF NOT EXISTS email_send_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  step_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  variant_id INTEGER,
  variant_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_at INTEGER NOT NULL DEFAULT (${nowMsSql}),
  sent_at INTEGER,
  message_id TEXT,
  tracking_token TEXT UNIQUE,
  unsubscribe_token TEXT,
  open_count INTEGER NOT NULL DEFAULT 0,
  first_opened_at INTEGER,
  click_count INTEGER NOT NULL DEFAULT 0,
  first_clicked_at INTEGER,
  replied_at INTEGER,
  bounce_kind TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (${nowMsSql})
);

CREATE TABLE IF NOT EXISTS unsubscribes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  campaign_id INTEGER,
  token TEXT NOT NULL UNIQUE,
  unsubscribed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (${nowMsSql})
);

CREATE TABLE IF NOT EXISTS click_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  send_job_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,
  lead_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  clicked_at INTEGER NOT NULL DEFAULT (${nowMsSql})
);

CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#06b6d4',
  created_at INTEGER NOT NULL DEFAULT (${nowMsSql})
);

CREATE TABLE IF NOT EXISTS lead_labels (
  lead_id INTEGER NOT NULL,
  label_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (${nowMsSql}),
  PRIMARY KEY (lead_id, label_id)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  sid TEXT PRIMARY KEY NOT NULL,
  sess TEXT NOT NULL,
  expire INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS send_jobs_status_sched_idx ON email_send_jobs(status, scheduled_at);
CREATE INDEX IF NOT EXISTS send_jobs_token_idx ON email_send_jobs(tracking_token);
CREATE INDEX IF NOT EXISTS send_jobs_message_id_idx ON email_send_jobs(message_id);
CREATE INDEX IF NOT EXISTS send_jobs_variant_idx ON email_send_jobs(variant_id);
CREATE INDEX IF NOT EXISTS sequence_step_variants_step_idx ON sequence_step_variants(step_id);
CREATE INDEX IF NOT EXISTS sequence_step_variants_label_idx ON sequence_step_variants(label_id);
CREATE INDEX IF NOT EXISTS unsub_token_idx ON unsubscribes(token);
CREATE INDEX IF NOT EXISTS unsub_lead_idx ON unsubscribes(lead_id);
CREATE INDEX IF NOT EXISTS click_events_campaign_idx ON click_events(campaign_id);
CREATE INDEX IF NOT EXISTS click_events_campaign_url_idx ON click_events(campaign_id, url);
CREATE INDEX IF NOT EXISTS IDX_user_sessions_expire ON user_sessions(expire);
`);

const campaignColumns = sqlite.prepare("PRAGMA table_info(campaigns)").all() as Array<{ name: string }>;
const campaignColumnNames = new Set(campaignColumns.map((column) => column.name));
if (!campaignColumnNames.has("batch_size")) {
  sqlite.exec("ALTER TABLE campaigns ADD COLUMN batch_size INTEGER NOT NULL DEFAULT 25");
}
if (!campaignColumnNames.has("batch_interval_minutes")) {
  sqlite.exec("ALTER TABLE campaigns ADD COLUMN batch_interval_minutes INTEGER NOT NULL DEFAULT 60");
}
if (!campaignColumnNames.has("send_window_start")) {
  sqlite.exec("ALTER TABLE campaigns ADD COLUMN send_window_start TEXT NOT NULL DEFAULT '07:00'");
}
if (!campaignColumnNames.has("send_window_end")) {
  sqlite.exec("ALTER TABLE campaigns ADD COLUMN send_window_end TEXT NOT NULL DEFAULT '19:00'");
}
if (!campaignColumnNames.has("send_window_timezone")) {
  sqlite.exec("ALTER TABLE campaigns ADD COLUMN send_window_timezone TEXT NOT NULL DEFAULT 'Australia/Sydney'");
}
if (!campaignColumnNames.has("send_window_days")) {
  sqlite.exec("ALTER TABLE campaigns ADD COLUMN send_window_days TEXT NOT NULL DEFAULT 'mon,tue,wed,thu,fri'");
}

const templateColumns = sqlite.prepare("PRAGMA table_info(email_templates)").all() as Array<{ name: string }>;
const templateColumnNames = new Set(templateColumns.map((column) => column.name));
if (!templateColumnNames.has("attachments_json")) {
  sqlite.exec("ALTER TABLE email_templates ADD COLUMN attachments_json TEXT");
}

const sequenceStepColumns = sqlite.prepare("PRAGMA table_info(sequence_steps)").all() as Array<{ name: string }>;
const sequenceStepColumnNames = new Set(sequenceStepColumns.map((column) => column.name));
if (!sequenceStepColumnNames.has("attachments_json")) {
  sqlite.exec("ALTER TABLE sequence_steps ADD COLUMN attachments_json TEXT");
}

const sequenceVariantColumns = sqlite.prepare("PRAGMA table_info(sequence_step_variants)").all() as Array<{ name: string }>;
const sequenceVariantColumnNames = new Set(sequenceVariantColumns.map((column) => column.name));
if (!sequenceVariantColumnNames.has("attachments_json")) {
  sqlite.exec("ALTER TABLE sequence_step_variants ADD COLUMN attachments_json TEXT");
}

const sendJobColumns = sqlite.prepare("PRAGMA table_info(email_send_jobs)").all() as Array<{ name: string }>;
const sendJobColumnNames = new Set(sendJobColumns.map((column) => column.name));
if (!sendJobColumnNames.has("variant_id")) {
  sqlite.exec("ALTER TABLE email_send_jobs ADD COLUMN variant_id INTEGER");
}
if (!sendJobColumnNames.has("variant_name")) {
  sqlite.exec("ALTER TABLE email_send_jobs ADD COLUMN variant_name TEXT");
}
sqlite.exec("CREATE INDEX IF NOT EXISTS send_jobs_variant_idx ON email_send_jobs(variant_id)");
sqlite.exec(`
UPDATE email_send_jobs
SET
  variant_id = (
    SELECT sequence_step_variants.id
    FROM sequence_step_variants
    INNER JOIN lead_labels
      ON lead_labels.label_id = sequence_step_variants.label_id
      AND lead_labels.lead_id = email_send_jobs.lead_id
    WHERE sequence_step_variants.step_id = email_send_jobs.step_id
    ORDER BY sequence_step_variants.priority DESC, sequence_step_variants.id ASC
    LIMIT 1
  ),
  variant_name = (
    SELECT sequence_step_variants.name
    FROM sequence_step_variants
    INNER JOIN lead_labels
      ON lead_labels.label_id = sequence_step_variants.label_id
      AND lead_labels.lead_id = email_send_jobs.lead_id
    WHERE sequence_step_variants.step_id = email_send_jobs.step_id
    ORDER BY sequence_step_variants.priority DESC, sequence_step_variants.id ASC
    LIMIT 1
  )
WHERE variant_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM sequence_step_variants
    INNER JOIN lead_labels
      ON lead_labels.label_id = sequence_step_variants.label_id
      AND lead_labels.lead_id = email_send_jobs.lead_id
    WHERE sequence_step_variants.step_id = email_send_jobs.step_id
  );
`);

const leadColumns = sqlite.prepare("PRAGMA table_info(leads)").all() as Array<{ name: string }>;
const leadColumnNames = new Set(leadColumns.map((column) => column.name));
if (!leadColumnNames.has("linkedin_url")) {
  sqlite.exec("ALTER TABLE leads ADD COLUMN linkedin_url TEXT");
}
if (!leadColumnNames.has("role_title")) {
  sqlite.exec("ALTER TABLE leads ADD COLUMN role_title TEXT");
}
if (!leadColumnNames.has("custom_fields_json")) {
  sqlite.exec("ALTER TABLE leads ADD COLUMN custom_fields_json TEXT");
}

const accountColumns = sqlite.prepare("PRAGMA table_info(email_accounts)").all() as Array<{ name: string }>;
const accountColumnNames = new Set(accountColumns.map((column) => column.name));
if (!accountColumnNames.has("sent_today_date")) {
  sqlite.exec("ALTER TABLE email_accounts ADD COLUMN sent_today_date TEXT");
}
sqlite.exec("UPDATE email_accounts SET status = 'warming' WHERE warmup_enabled = 1 AND status = 'connected'");

export const db = drizzle(sqlite, { schema });

export * from "./schema";

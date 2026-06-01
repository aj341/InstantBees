import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const accountProviderValues = ["gmail", "outlook", "smtp"] as const;
export const accountStatusValues = ["connected", "disconnected", "error", "warming"] as const;

export const emailAccountsTable = sqliteTable("email_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name"),
  provider: text("provider", { enum: accountProviderValues }).notNull(),
  status: text("status", { enum: accountStatusValues }).notNull().default("connected"),
  warmupEnabled: integer("warmup_enabled", { mode: "boolean" }).notNull().default(false),
  dailySendLimit: integer("daily_send_limit").notNull().default(50),
  sentToday: integer("sent_today").notNull().default(0),
  sentTodayDate: text("sent_today_date"),
  healthScore: integer("health_score"),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpUsername: text("smtp_username"),
  smtpPasswordEnc: text("smtp_password_enc"),
  imapHost: text("imap_host"),
  imapPort: integer("imap_port"),
  imapLastUid: integer("imap_last_uid"),
  lastPolledAt: integer("last_polled_at", { mode: "timestamp_ms" }),
  lastError: text("last_error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const insertEmailAccountSchema = createInsertSchema(emailAccountsTable).omit({ id: true, createdAt: true });
export type InsertEmailAccount = z.infer<typeof insertEmailAccountSchema>;
export type EmailAccount = typeof emailAccountsTable.$inferSelect;

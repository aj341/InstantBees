import { pgTable, serial, text, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const accountProviderEnum = pgEnum("account_provider", ["gmail", "outlook", "smtp"]);
export const accountStatusEnum = pgEnum("account_status", ["connected", "disconnected", "error", "warming"]);

export const emailAccountsTable = pgTable("email_accounts", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  provider: accountProviderEnum("provider").notNull(),
  status: accountStatusEnum("status").notNull().default("connected"),
  warmupEnabled: boolean("warmup_enabled").notNull().default(false),
  dailySendLimit: integer("daily_send_limit").notNull().default(50),
  sentToday: integer("sent_today").notNull().default(0),
  healthScore: integer("health_score"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertEmailAccountSchema = createInsertSchema(emailAccountsTable).omit({ id: true, createdAt: true });
export type InsertEmailAccount = z.infer<typeof insertEmailAccountSchema>;
export type EmailAccount = typeof emailAccountsTable.$inferSelect;

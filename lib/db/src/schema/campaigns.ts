import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const campaignStatusValues = ["draft", "active", "paused", "completed"] as const;

export const campaignsTable = sqliteTable("campaigns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  status: text("status", { enum: campaignStatusValues }).notNull().default("draft"),
  fromName: text("from_name"),
  replyTo: text("reply_to"),
  dailyLimit: integer("daily_limit"),
  batchSize: integer("batch_size").notNull().default(16),
  batchIntervalMinutes: integer("batch_interval_minutes").notNull().default(65),
  sendWindowStart: text("send_window_start").notNull().default("07:00"),
  sendWindowEnd: text("send_window_end").notNull().default("19:00"),
  sendWindowTimezone: text("send_window_timezone").notNull().default("Australia/Sydney"),
  sendWindowDays: text("send_window_days").notNull().default("mon,tue,wed,thu,fri"),
  trackOpens: integer("track_opens", { mode: "boolean" }).notNull().default(true),
  trackClicks: integer("track_clicks", { mode: "boolean" }).notNull().default(true),
  includeUnsubscribe: integer("include_unsubscribe", { mode: "boolean" }).notNull().default(true),
  leadsCount: integer("leads_count").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  openCount: integer("open_count").notNull().default(0),
  clickCount: integer("click_count").notNull().default(0),
  replyCount: integer("reply_count").notNull().default(0),
  bounceCount: integer("bounce_count").notNull().default(0),
  scheduledStartAt: integer("scheduled_start_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({ id: true, createdAt: true });
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;

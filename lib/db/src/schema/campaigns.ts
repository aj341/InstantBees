import { pgTable, serial, text, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const campaignStatusEnum = pgEnum("campaign_status", ["draft", "active", "paused", "completed"]);

export const campaignsTable = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  status: campaignStatusEnum("status").notNull().default("draft"),
  fromName: text("from_name"),
  replyTo: text("reply_to"),
  dailyLimit: integer("daily_limit"),
  trackOpens: boolean("track_opens").notNull().default(true),
  trackClicks: boolean("track_clicks").notNull().default(true),
  leadsCount: integer("leads_count").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  openCount: integer("open_count").notNull().default(0),
  replyCount: integer("reply_count").notNull().default(0),
  bounceCount: integer("bounce_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertCampaignSchema = createInsertSchema(campaignsTable).omit({ id: true, createdAt: true });
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaignsTable.$inferSelect;

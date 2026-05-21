import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";

export const clickEventsTable = pgTable("click_events", {
  id: serial("id").primaryKey(),
  sendJobId: integer("send_job_id").notNull(),
  campaignId: integer("campaign_id").notNull(),
  leadId: integer("lead_id").notNull(),
  url: text("url").notNull(),
  clickedAt: timestamp("clicked_at").notNull().defaultNow(),
}, (t) => ({
  campaignIdx: index("click_events_campaign_idx").on(t.campaignId),
  campaignUrlIdx: index("click_events_campaign_url_idx").on(t.campaignId, t.url),
}));

export type ClickEvent = typeof clickEventsTable.$inferSelect;

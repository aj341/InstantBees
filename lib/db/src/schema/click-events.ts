import { sqliteTable, integer, text, index } from "drizzle-orm/sqlite-core";

export const clickEventsTable = sqliteTable("click_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sendJobId: integer("send_job_id").notNull(),
  campaignId: integer("campaign_id").notNull(),
  leadId: integer("lead_id").notNull(),
  url: text("url").notNull(),
  clickedAt: integer("clicked_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => ({
  campaignIdx: index("click_events_campaign_idx").on(t.campaignId),
  campaignUrlIdx: index("click_events_campaign_url_idx").on(t.campaignId, t.url),
}));

export type ClickEvent = typeof clickEventsTable.$inferSelect;

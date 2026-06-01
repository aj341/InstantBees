import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const unsubscribesTable = sqliteTable("unsubscribes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").notNull(),
  campaignId: integer("campaign_id"),
  token: text("token").notNull().unique(),
  unsubscribedAt: integer("unsubscribed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => ({
  tokenIdx: index("unsub_token_idx").on(t.token),
  leadIdx: index("unsub_lead_idx").on(t.leadId),
}));

export const insertUnsubscribeSchema = createInsertSchema(unsubscribesTable).omit({ id: true, createdAt: true });
export type InsertUnsubscribe = z.infer<typeof insertUnsubscribeSchema>;
export type Unsubscribe = typeof unsubscribesTable.$inferSelect;

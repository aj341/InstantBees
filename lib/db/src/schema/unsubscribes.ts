import { pgTable, serial, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const unsubscribesTable = pgTable("unsubscribes", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull(),
  campaignId: integer("campaign_id"),
  token: text("token").notNull().unique(),
  unsubscribedAt: timestamp("unsubscribed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  tokenIdx: index("unsub_token_idx").on(t.token),
  leadIdx: index("unsub_lead_idx").on(t.leadId),
}));

export const insertUnsubscribeSchema = createInsertSchema(unsubscribesTable).omit({ id: true, createdAt: true });
export type InsertUnsubscribe = z.infer<typeof insertUnsubscribeSchema>;
export type Unsubscribe = typeof unsubscribesTable.$inferSelect;

import { pgTable, serial, text, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sentimentEnum = pgEnum("sentiment", ["positive", "neutral", "negative"]);

export const inboxMessagesTable = pgTable("inbox_messages", {
  id: serial("id").primaryKey(),
  fromEmail: text("from_email").notNull(),
  fromName: text("from_name"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  isRead: boolean("is_read").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
  isFavorite: boolean("is_favorite").notNull().default(false),
  sentiment: sentimentEnum("sentiment"),
  campaignId: integer("campaign_id"),
  leadId: integer("lead_id"),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
});

export const insertInboxMessageSchema = createInsertSchema(inboxMessagesTable).omit({ id: true });
export type InsertInboxMessage = z.infer<typeof insertInboxMessageSchema>;
export type InboxMessage = typeof inboxMessagesTable.$inferSelect;

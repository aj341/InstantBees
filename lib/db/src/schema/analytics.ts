import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dailyStatsTable = pgTable("daily_stats", {
  id: serial("id").primaryKey(),
  date: text("date").notNull().unique(),
  sent: integer("sent").notNull().default(0),
  opened: integer("opened").notNull().default(0),
  replied: integer("replied").notNull().default(0),
  bounced: integer("bounced").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDailyStatsSchema = createInsertSchema(dailyStatsTable).omit({ id: true, createdAt: true });
export type InsertDailyStats = z.infer<typeof insertDailyStatsSchema>;
export type DailyStats = typeof dailyStatsTable.$inferSelect;

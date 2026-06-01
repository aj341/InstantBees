import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const dailyStatsTable = sqliteTable("daily_stats", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull().unique(),
  sent: integer("sent").notNull().default(0),
  opened: integer("opened").notNull().default(0),
  replied: integer("replied").notNull().default(0),
  bounced: integer("bounced").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const insertDailyStatsSchema = createInsertSchema(dailyStatsTable).omit({ id: true, createdAt: true });
export type InsertDailyStats = z.infer<typeof insertDailyStatsSchema>;
export type DailyStats = typeof dailyStatsTable.$inferSelect;

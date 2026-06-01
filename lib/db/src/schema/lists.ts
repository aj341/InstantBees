import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const leadListsTable = sqliteTable("lead_lists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const listLeadsTable = sqliteTable("list_leads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  listId: integer("list_id").notNull(),
  leadId: integer("lead_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const insertLeadListSchema = createInsertSchema(leadListsTable).omit({ id: true, createdAt: true });
export type InsertLeadList = z.infer<typeof insertLeadListSchema>;
export type LeadList = typeof leadListsTable.$inferSelect;

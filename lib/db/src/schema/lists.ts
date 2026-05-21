import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const leadListsTable = pgTable("lead_lists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const listLeadsTable = pgTable("list_leads", {
  id: serial("id").primaryKey(),
  listId: integer("list_id").notNull(),
  leadId: integer("lead_id").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLeadListSchema = createInsertSchema(leadListsTable).omit({ id: true, createdAt: true });
export type InsertLeadList = z.infer<typeof insertLeadListSchema>;
export type LeadList = typeof leadListsTable.$inferSelect;

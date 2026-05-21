import { pgTable, serial, text, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const labelsTable = pgTable("labels", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  color: text("color").notNull().default("#06b6d4"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

import { leadsTable } from "./leads";

export const leadLabelsTable = pgTable(
  "lead_labels",
  {
    leadId: integer("lead_id").notNull().references(() => leadsTable.id, { onDelete: "cascade" }),
    labelId: integer("label_id").notNull().references(() => labelsTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.leadId, t.labelId] }),
  }),
);

export const insertLabelSchema = createInsertSchema(labelsTable).omit({ id: true, createdAt: true });
export type InsertLabel = z.infer<typeof insertLabelSchema>;
export type Label = typeof labelsTable.$inferSelect;

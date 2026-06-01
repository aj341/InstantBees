import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { labelsTable } from "./labels";

export const sequenceStepsTable = sqliteTable("sequence_steps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  campaignId: integer("campaign_id").notNull(),
  stepNumber: integer("step_number").notNull().default(1),
  subject: text("subject").notNull(),
  previewText: text("preview_text"),
  body: text("body").notNull(),
  bodyType: text("body_type").notNull().default("text"),
  attachmentsJson: text("attachments_json"),
  delayDays: integer("delay_days").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const sequenceStepVariantsTable = sqliteTable("sequence_step_variants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stepId: integer("step_id").notNull().references(() => sequenceStepsTable.id, { onDelete: "cascade" }),
  labelId: integer("label_id").notNull().references(() => labelsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  previewText: text("preview_text"),
  body: text("body").notNull(),
  bodyType: text("body_type").notNull().default("text"),
  attachmentsJson: text("attachments_json"),
  priority: integer("priority").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const insertSequenceStepSchema = createInsertSchema(sequenceStepsTable).omit({ id: true, createdAt: true, stepNumber: true });
export const insertSequenceStepVariantSchema = createInsertSchema(sequenceStepVariantsTable).omit({ id: true, createdAt: true });
export type InsertSequenceStep = z.infer<typeof insertSequenceStepSchema>;
export type InsertSequenceStepVariant = z.infer<typeof insertSequenceStepVariantSchema>;
export type SequenceStep = typeof sequenceStepsTable.$inferSelect;
export type SequenceStepVariant = typeof sequenceStepVariantsTable.$inferSelect;

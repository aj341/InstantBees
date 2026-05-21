import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sequenceStepsTable = pgTable("sequence_steps", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull(),
  stepNumber: integer("step_number").notNull().default(1),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  delayDays: integer("delay_days").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSequenceStepSchema = createInsertSchema(sequenceStepsTable).omit({ id: true, createdAt: true, stepNumber: true });
export type InsertSequenceStep = z.infer<typeof insertSequenceStepSchema>;
export type SequenceStep = typeof sequenceStepsTable.$inferSelect;

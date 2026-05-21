import { pgTable, serial, text, integer, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sendJobStatusEnum = pgEnum("send_job_status", ["pending", "in_progress", "sent", "failed", "skipped"]);

export const emailSendJobsTable = pgTable("email_send_jobs", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull(),
  leadId: integer("lead_id").notNull(),
  stepId: integer("step_id").notNull(),
  accountId: integer("account_id").notNull(),
  status: sendJobStatusEnum("status").notNull().default("pending"),
  scheduledAt: timestamp("scheduled_at").notNull().defaultNow(),
  sentAt: timestamp("sent_at"),
  messageId: text("message_id"),
  errorMessage: text("error_message"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  statusScheduledIdx: index("send_jobs_status_sched_idx").on(t.status, t.scheduledAt),
}));

export const insertEmailSendJobSchema = createInsertSchema(emailSendJobsTable).omit({ id: true, createdAt: true });
export type InsertEmailSendJob = z.infer<typeof insertEmailSendJobSchema>;
export type EmailSendJob = typeof emailSendJobsTable.$inferSelect;

import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sendJobStatusValues = ["pending", "in_progress", "sent", "failed", "skipped"] as const;
export const bounceKindValues = ["hard", "soft"] as const;

export const emailSendJobsTable = sqliteTable("email_send_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  campaignId: integer("campaign_id").notNull(),
  leadId: integer("lead_id").notNull(),
  stepId: integer("step_id").notNull(),
  accountId: integer("account_id").notNull(),
  variantId: integer("variant_id"),
  variantName: text("variant_name"),
  status: text("status", { enum: sendJobStatusValues }).notNull().default("pending"),
  scheduledAt: integer("scheduled_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  sentAt: integer("sent_at", { mode: "timestamp_ms" }),
  messageId: text("message_id"),
  trackingToken: text("tracking_token").unique(),
  unsubscribeToken: text("unsubscribe_token"),
  openCount: integer("open_count").notNull().default(0),
  firstOpenedAt: integer("first_opened_at", { mode: "timestamp_ms" }),
  clickCount: integer("click_count").notNull().default(0),
  firstClickedAt: integer("first_clicked_at", { mode: "timestamp_ms" }),
  repliedAt: integer("replied_at", { mode: "timestamp_ms" }),
  bounceKind: text("bounce_kind", { enum: bounceKindValues }),
  errorMessage: text("error_message"),
  attempts: integer("attempts").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
}, (t) => ({
  statusScheduledIdx: index("send_jobs_status_sched_idx").on(t.status, t.scheduledAt),
  tokenIdx: index("send_jobs_token_idx").on(t.trackingToken),
  messageIdIdx: index("send_jobs_message_id_idx").on(t.messageId),
}));

export const insertEmailSendJobSchema = createInsertSchema(emailSendJobsTable).omit({ id: true, createdAt: true });
export type InsertEmailSendJob = z.infer<typeof insertEmailSendJobSchema>;
export type EmailSendJob = typeof emailSendJobsTable.$inferSelect;

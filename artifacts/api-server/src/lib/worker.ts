import { and, eq, lte, sql, inArray, asc } from "drizzle-orm";
import {
  db,
  emailSendJobsTable,
  emailAccountsTable,
  leadsTable,
  sequenceStepsTable,
  campaignsTable,
  dailyStatsTable,
  unsubscribesTable,
  type EmailSendJob,
} from "@workspace/db";
import { sendEmail, renderMergeFields, generateTrackingToken, getPublicBaseUrl, buildMessageId } from "./mailer";
import { logger } from "./logger";

const POLL_INTERVAL_MS = 10_000;
const BATCH_SIZE = 5;
const STALE_CLAIM_MS = 5 * 60 * 1000;

let running = false;
let timer: NodeJS.Timeout | null = null;

async function claimJobs(now: Date): Promise<EmailSendJob[]> {
  return await db.transaction(async (tx) => {
    const candidates = await tx
      .select({ id: emailSendJobsTable.id })
      .from(emailSendJobsTable)
      .where(and(eq(emailSendJobsTable.status, "pending"), lte(emailSendJobsTable.scheduledAt, now)))
      .orderBy(asc(emailSendJobsTable.scheduledAt))
      .limit(BATCH_SIZE)
      .for("update", { skipLocked: true });

    if (candidates.length === 0) return [];
    const ids = candidates.map((c) => c.id);
    const claimed = await tx
      .update(emailSendJobsTable)
      .set({ status: "in_progress", attempts: sql`${emailSendJobsTable.attempts} + 1` })
      .where(inArray(emailSendJobsTable.id, ids))
      .returning();
    return claimed;
  });
}

async function reclaimStale(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - STALE_CLAIM_MS);
  await db
    .update(emailSendJobsTable)
    .set({ status: "pending" })
    .where(and(eq(emailSendJobsTable.status, "in_progress"), lte(emailSendJobsTable.scheduledAt, cutoff)));
}

async function processOnce(): Promise<void> {
  const now = new Date();
  await reclaimStale(now);
  const jobs = await claimJobs(now);
  if (jobs.length === 0) return;

  for (const job of jobs) {
    try {
      const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, job.campaignId));
      if (!campaign || campaign.status !== "active") {
        await db
          .update(emailSendJobsTable)
          .set({ status: "skipped", errorMessage: `Campaign not active (status: ${campaign?.status ?? "missing"})` })
          .where(eq(emailSendJobsTable.id, job.id));
        continue;
      }

      const [account] = await db.select().from(emailAccountsTable).where(eq(emailAccountsTable.id, job.accountId));
      const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, job.leadId));
      const [step] = await db.select().from(sequenceStepsTable).where(eq(sequenceStepsTable.id, job.stepId));

      if (!account || !lead || !step) {
        await db
          .update(emailSendJobsTable)
          .set({ status: "skipped", errorMessage: "Missing account, lead, or step" })
          .where(eq(emailSendJobsTable.id, job.id));
        continue;
      }

      if (lead.status !== "active") {
        await db
          .update(emailSendJobsTable)
          .set({ status: "skipped", errorMessage: `Lead status is ${lead.status}` })
          .where(eq(emailSendJobsTable.id, job.id));
        continue;
      }

      const vars = {
        firstName: lead.firstName ?? "",
        lastName: lead.lastName ?? "",
        company: lead.company ?? "",
        title: lead.title ?? "",
        email: lead.email,
      };
      const subject = renderMergeFields(step.subject, vars);
      const body = renderMergeFields(step.body, vars);
      const previewText = step.previewText ? renderMergeFields(step.previewText, vars) : null;

      const publicBaseUrl = getPublicBaseUrl();
      const trackingToken = campaign.trackOpens || campaign.trackClicks ? (job.trackingToken ?? generateTrackingToken()) : null;

      let unsubscribeToken: string | null = null;
      if (campaign.includeUnsubscribe) {
        const existing = await db
          .select()
          .from(unsubscribesTable)
          .where(and(eq(unsubscribesTable.leadId, lead.id), eq(unsubscribesTable.campaignId, campaign.id)))
          .limit(1);
        if (existing.length > 0 && existing[0]) {
          unsubscribeToken = existing[0].token;
        } else {
          const token = generateTrackingToken();
          const [inserted] = await db
            .insert(unsubscribesTable)
            .values({ leadId: lead.id, campaignId: campaign.id, token })
            .returning();
          unsubscribeToken = inserted?.token ?? token;
        }
      }

      const outboundMessageId = buildMessageId(account);

      const { messageId } = await sendEmail(account, {
        to: lead.email,
        toName: [lead.firstName, lead.lastName].filter(Boolean).join(" ") || null,
        subject,
        previewText,
        body,
        bodyType: step.bodyType,
        trackingToken: trackingToken ?? undefined,
        unsubscribeToken: unsubscribeToken ?? undefined,
        publicBaseUrl,
        messageId: outboundMessageId,
        trackClicks: campaign.trackClicks,
      });

      await db
        .update(emailSendJobsTable)
        .set({
          status: "sent",
          sentAt: new Date(),
          messageId,
          trackingToken: trackingToken ?? undefined,
          unsubscribeToken: unsubscribeToken ?? undefined,
        })
        .where(eq(emailSendJobsTable.id, job.id));

      await db
        .update(campaignsTable)
        .set({ sentCount: sql`${campaignsTable.sentCount} + 1` })
        .where(eq(campaignsTable.id, job.campaignId));

      await db
        .update(emailAccountsTable)
        .set({ sentToday: sql`${emailAccountsTable.sentToday} + 1`, status: "connected", lastError: null })
        .where(eq(emailAccountsTable.id, account.id));

      const today = new Date().toISOString().slice(0, 10);
      const [existing] = await db.select().from(dailyStatsTable).where(eq(dailyStatsTable.date, today));
      if (existing) {
        await db
          .update(dailyStatsTable)
          .set({ sent: sql`${dailyStatsTable.sent} + 1` })
          .where(eq(dailyStatsTable.date, today));
      } else {
        await db.insert(dailyStatsTable).values({ date: today, sent: 1 }).onConflictDoNothing();
      }

      logger.info({ jobId: job.id, to: lead.email, campaignId: job.campaignId }, "Sent campaign email");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ jobId: job.id, err: message }, "Failed to send campaign email");
      await db
        .update(emailSendJobsTable)
        .set({ status: "failed", errorMessage: message })
        .where(eq(emailSendJobsTable.id, job.id));
      await db
        .update(emailAccountsTable)
        .set({ status: "error", lastError: message })
        .where(eq(emailAccountsTable.id, job.accountId));
    }
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await processOnce();
  } catch (err) {
    logger.error({ err }, "Worker tick failed");
  } finally {
    running = false;
  }
}

export function startSendWorker(): void {
  if (timer) return;
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Starting email send worker");
  timer = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
  void tick();
}

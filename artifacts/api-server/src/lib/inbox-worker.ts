import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import {
  campaignsTable,
  db,
  emailAccountsTable,
  emailSendJobsTable,
  inboxMessagesTable,
  leadsTable,
} from "@workspace/db";
import { resolveImap } from "./mailer";
import { logger } from "./logger";
import { classifyReply } from "./reply-classifier";

const POLL_INTERVAL_MS = 60_000;
const FETCH_LIMIT = 50;
const RESCAN_RECENT_LIMIT = 250;

let timer: NodeJS.Timeout | null = null;
let running = false;

function normalizeMessageId(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim().replace(/^</, "").replace(/>$/, "").toLowerCase();
}

function valuesFromHeader(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(valuesFromHeader);
  return String(value).split(/\s+/).map((part) => part.trim()).filter(Boolean);
}

function isBounce(fromEmail: string, subject: string, body: string): boolean {
  return classifyReply({ fromEmail, subject, body }).category === "bounce";
}

async function markReply(jobId: number, receivedAt: Date): Promise<void> {
  const [job] = await db.select().from(emailSendJobsTable).where(eq(emailSendJobsTable.id, jobId));
  if (!job) return;

  const firstReply = await db
    .update(emailSendJobsTable)
    .set({ repliedAt: receivedAt, firstOpenedAt: job.firstOpenedAt ?? receivedAt })
    .where(and(eq(emailSendJobsTable.id, job.id), isNull(emailSendJobsTable.repliedAt)))
    .returning({ id: emailSendJobsTable.id });

  if (firstReply.length > 0) {
    await db.update(campaignsTable).set({ replyCount: sql`${campaignsTable.replyCount} + 1` }).where(eq(campaignsTable.id, job.campaignId));
    await db.update(leadsTable).set({ status: "replied" }).where(eq(leadsTable.id, job.leadId));
  }
}

async function markBounce(jobId: number, receivedAt: Date): Promise<void> {
  const [job] = await db.select().from(emailSendJobsTable).where(eq(emailSendJobsTable.id, jobId));
  if (!job) return;

  const firstBounce = await db
    .update(emailSendJobsTable)
    .set({ bounceKind: "hard", repliedAt: null, errorMessage: "Delivery failure notification received" })
    .where(and(eq(emailSendJobsTable.id, job.id), isNull(emailSendJobsTable.bounceKind)))
    .returning({ id: emailSendJobsTable.id });

  if (firstBounce.length > 0) {
    await db.update(campaignsTable).set({ bounceCount: sql`${campaignsTable.bounceCount} + 1` }).where(eq(campaignsTable.id, job.campaignId));
    await db.update(leadsTable).set({ status: "bounced" }).where(eq(leadsTable.id, job.leadId));
  }
}

async function findJobForMessage(parsed: Awaited<ReturnType<typeof simpleParser>>, fromEmail: string, body: string): Promise<typeof emailSendJobsTable.$inferSelect | null> {
  const jobs = await db.select().from(emailSendJobsTable).where(eq(emailSendJobsTable.status, "sent"));
  const byMessageId = new Map<string, typeof emailSendJobsTable.$inferSelect>();
  for (const job of jobs) {
    const normalized = normalizeMessageId(job.messageId);
    if (normalized) byMessageId.set(normalized, job);
  }

  const headers = parsed.headers;
  const ids = [
    ...valuesFromHeader(headers.get("in-reply-to")),
    ...valuesFromHeader(headers.get("references")),
  ].map(normalizeMessageId).filter((id): id is string => !!id);

  for (const id of ids) {
    const job = byMessageId.get(id);
    if (job) return job;
  }

  const bodyLower = body.toLowerCase();
  for (const [messageId, job] of byMessageId) {
    if (bodyLower.includes(messageId)) return job;
  }

  const leadRows = await db.select().from(leadsTable).where(eq(leadsTable.email, fromEmail));
  const lead = leadRows[0];
  if (!lead) return null;
  const matching = jobs
    .filter((job) => job.leadId === lead.id)
    .sort((a, b) => (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0));
  return matching[0] ?? null;
}

async function pollAccount(account: typeof emailAccountsTable.$inferSelect): Promise<void> {
  const imap = resolveImap(account);
  if (!imap) return;

  const client = new ImapFlow({
    host: imap.host,
    port: imap.port,
    secure: imap.port === 993,
    family: 4,
    auth: { user: imap.username, pass: imap.password },
    logger: false,
  });
  client.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ accountId: account.id, err: message }, "IMAP connection error");
  });

  try {
    await client.connect();
    const mailbox = await client.mailboxOpen("INBOX");
    const maxUid = mailbox.exists ? mailbox.uidNext - 1 : 0;
    const newMailUid = account.imapLastUid && account.imapLastUid > 0 ? account.imapLastUid + 1 : Math.max(1, maxUid - FETCH_LIMIT + 1);
    const rescanUid = Math.max(1, maxUid - RESCAN_RECENT_LIMIT + 1);
    const sinceUid = Math.min(newMailUid, rescanUid);
    if (maxUid < sinceUid) {
      await db.update(emailAccountsTable).set({ lastPolledAt: new Date(), lastError: null }).where(eq(emailAccountsTable.id, account.id));
      return;
    }

    let highestUid = account.imapLastUid ?? 0;
    for await (const message of client.fetch(`${sinceUid}:*`, { uid: true, source: true })) {
      highestUid = Math.max(highestUid, message.uid);
      if (!message.source) continue;

      const parsed = await simpleParser(message.source);
      const from = parsed.from?.value[0];
      const fromEmail = from?.address?.toLowerCase();
      if (!fromEmail || fromEmail === account.email.toLowerCase()) continue;

      const subject = parsed.subject ?? "(no subject)";
      const body = parsed.text || parsed.html?.toString() || "";
      const receivedAt = parsed.date ?? new Date();
      const job = await findJobForMessage(parsed, fromEmail, body);
      if (!job) continue;

      const existingMessage = await db
        .select({ id: inboxMessagesTable.id })
        .from(inboxMessagesTable)
        .where(and(
          eq(inboxMessagesTable.fromEmail, fromEmail),
          eq(inboxMessagesTable.subject, subject),
          eq(inboxMessagesTable.receivedAt, receivedAt),
        ))
        .limit(1);

      if (existingMessage.length === 0) {
        const classification = classifyReply({ fromEmail, subject, body });
        await db.insert(inboxMessagesTable).values({
          fromEmail,
          fromName: from?.name || null,
          subject,
          body,
          sentiment: classification.sentiment,
          campaignId: job.campaignId,
          leadId: job.leadId,
          receivedAt,
        });
      }

      if (isBounce(fromEmail, subject, body)) {
        await markBounce(job.id, receivedAt);
      } else {
        await markReply(job.id, receivedAt);
      }
    }

    await db
      .update(emailAccountsTable)
      .set({ imapLastUid: highestUid || account.imapLastUid, lastPolledAt: new Date(), lastError: null })
      .where(eq(emailAccountsTable.id, account.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ accountId: account.id, err: message }, "Failed to poll inbox");
    await db.update(emailAccountsTable).set({ lastPolledAt: new Date(), lastError: message }).where(eq(emailAccountsTable.id, account.id));
  } finally {
    await client.logout().catch(() => undefined);
  }
}

async function pollOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const accounts = await db
      .select()
      .from(emailAccountsTable)
      .where(and(inArray(emailAccountsTable.status, ["connected", "warming"]), gt(emailAccountsTable.id, 0)));
    for (const account of accounts) {
      await pollAccount(account);
    }
  } finally {
    running = false;
  }
}

export function startInboxWorker(): void {
  if (timer) return;
  void pollOnce();
  timer = setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Starting inbox reply/bounce worker");
}

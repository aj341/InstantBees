import { and, eq, inArray, ne } from "drizzle-orm";
import { campaignsTable, db, emailAccountsTable, emailSendJobsTable } from "@workspace/db";

type AccountRow = typeof emailAccountsTable.$inferSelect;

export function isTransientAccountError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /timeout|timed out|etimedout|econnreset|econnrefused|esocket|econnection|greeting never received|temporar/i.test(message);
}

export function isSendableAccount(account: Pick<AccountRow, "status" | "smtpPasswordEnc" | "lastError">): boolean {
  if (!account.smtpPasswordEnc) return false;
  if (account.status === "connected" || account.status === "warming") return true;
  return account.status === "error" && isTransientAccountError(account.lastError);
}

export async function getSendableAccounts(excludeAccountId?: number): Promise<AccountRow[]> {
  const accounts = await db
    .select()
    .from(emailAccountsTable)
    .where(inArray(emailAccountsTable.status, ["connected", "warming", "error"]))
    .orderBy(emailAccountsTable.createdAt);

  return accounts.filter((account) => {
    if (excludeAccountId && account.id === excludeAccountId) return false;
    return isSendableAccount(account);
  });
}

export async function rebalancePendingJobsForCampaign(campaignId: number, excludeAccountId?: number): Promise<number> {
  const accounts = await getSendableAccounts(excludeAccountId);
  if (accounts.length === 0) return 0;

  const jobs = await db
    .select()
    .from(emailSendJobsTable)
    .where(and(
      eq(emailSendJobsTable.campaignId, campaignId),
      inArray(emailSendJobsTable.status, ["pending", "in_progress"]),
    ))
    .orderBy(emailSendJobsTable.scheduledAt, emailSendJobsTable.id);

  let changed = 0;
  for (const [index, job] of jobs.entries()) {
    const account = accounts[index % accounts.length]!;
    if (job.accountId === account.id) continue;
    await db
      .update(emailSendJobsTable)
      .set({ accountId: account.id, errorMessage: null })
      .where(eq(emailSendJobsTable.id, job.id));
    changed++;
  }
  return changed;
}

export async function rebalancePendingJobsForActiveCampaigns(excludeAccountId?: number): Promise<number> {
  const campaigns = await db.select({ id: campaignsTable.id }).from(campaignsTable).where(eq(campaignsTable.status, "active"));
  let changed = 0;
  for (const campaign of campaigns) {
    changed += await rebalancePendingJobsForCampaign(campaign.id, excludeAccountId);
  }
  return changed;
}

export async function reassignPendingJobsForAccount(accountId: number): Promise<number> {
  const accounts = await getSendableAccounts(accountId);
  if (accounts.length === 0) return 0;

  const jobs = await db
    .select()
    .from(emailSendJobsTable)
    .where(and(
      eq(emailSendJobsTable.accountId, accountId),
      inArray(emailSendJobsTable.status, ["pending", "in_progress"]),
    ))
    .orderBy(emailSendJobsTable.scheduledAt, emailSendJobsTable.id);

  for (const [index, job] of jobs.entries()) {
    const account = accounts[index % accounts.length]!;
    await db
      .update(emailSendJobsTable)
      .set({ accountId: account.id, errorMessage: null, status: "pending" })
      .where(eq(emailSendJobsTable.id, job.id));
  }

  return jobs.length;
}

export async function hasPendingJobsForAccount(accountId: number): Promise<boolean> {
  const [job] = await db
    .select({ id: emailSendJobsTable.id })
    .from(emailSendJobsTable)
    .where(and(
      eq(emailSendJobsTable.accountId, accountId),
      inArray(emailSendJobsTable.status, ["pending", "in_progress"]),
    ))
    .limit(1);
  return !!job;
}

export async function hasAlternativeSendableAccount(accountId: number): Promise<boolean> {
  const accounts = await getSendableAccounts(accountId);
  return accounts.length > 0;
}

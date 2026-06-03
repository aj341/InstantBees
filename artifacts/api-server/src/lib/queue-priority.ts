import { asc, eq, inArray } from "drizzle-orm";
import {
  db,
  campaignsTable,
  campaignLeadsTable,
  emailSendJobsTable,
  leadsTable,
  sequenceStepsTable,
} from "@workspace/db";
import { nextSendWindowAt } from "./sending-window";

type PrioritizeInput = {
  leadIds?: number[];
  emails?: string[];
  limit?: number;
};

type PrioritizeResult = {
  campaignId: number;
  requestedLeads: number;
  prioritizedJobs: number;
  missingEmails: string[];
  scheduledFrom: string | null;
};

function uniquePositiveInts(values: unknown[] | undefined): number[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
}

function normalizedEmails(values: unknown[] | undefined): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean))];
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function prioritizeCampaignLeads(campaignId: number, input: PrioritizeInput): Promise<PrioritizeResult | null> {
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
  if (!campaign) return null;

  const requestedLeadIds = uniquePositiveInts(input.leadIds);
  const requestedEmails = normalizedEmails(input.emails);
  const limit = Number.isFinite(Number(input.limit)) && Number(input.limit) > 0 ? Math.floor(Number(input.limit)) : null;
  const missingEmails = new Set(requestedEmails);

  const campaignLeadRows = await db
    .select({ leadId: campaignLeadsTable.leadId })
    .from(campaignLeadsTable)
    .where(eq(campaignLeadsTable.campaignId, campaignId));
  const campaignLeadIdSet = new Set(campaignLeadRows.map((row) => row.leadId));

  const emailLeadIds: number[] = [];
  if (requestedEmails.length > 0) {
    const leads = await db.select().from(leadsTable).where(inArray(leadsTable.email, requestedEmails));
    for (const lead of leads) {
      missingEmails.delete(lead.email.toLowerCase());
      if (campaignLeadIdSet.has(lead.id)) emailLeadIds.push(lead.id);
    }
  }

  const targetLeadIds = [...new Set([
    ...requestedLeadIds.filter((leadId) => campaignLeadIdSet.has(leadId)),
    ...emailLeadIds,
    ...(requestedLeadIds.length === 0 && requestedEmails.length === 0 ? [...campaignLeadIdSet] : []),
  ])].slice(0, limit ?? undefined);

  if (targetLeadIds.length === 0) {
    return {
      campaignId,
      requestedLeads: 0,
      prioritizedJobs: 0,
      missingEmails: [...missingEmails],
      scheduledFrom: null,
    };
  }

  const steps = await db
    .select()
    .from(sequenceStepsTable)
    .where(eq(sequenceStepsTable.campaignId, campaignId))
    .orderBy(asc(sequenceStepsTable.stepNumber));
  const stepNumberById = new Map(steps.map((step) => [step.id, step.stepNumber]));
  const leadOrder = new Map(targetLeadIds.map((leadId, index) => [leadId, index]));

  const pendingJobs = await db
    .select()
    .from(emailSendJobsTable)
    .where(inArray(emailSendJobsTable.leadId, targetLeadIds));

  const earliestJobByLead = new Map<number, typeof pendingJobs[number]>();
  for (const job of pendingJobs.filter((job) => job.campaignId === campaignId && job.status === "pending")) {
    const existing = earliestJobByLead.get(job.leadId);
    const jobStep = stepNumberById.get(job.stepId) ?? Number.MAX_SAFE_INTEGER;
    const existingStep = existing ? stepNumberById.get(existing.stepId) ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
    if (
      !existing
      || jobStep < existingStep
      || (jobStep === existingStep && job.scheduledAt < existing.scheduledAt)
    ) {
      earliestJobByLead.set(job.leadId, job);
    }
  }

  const jobsToPrioritize = [...earliestJobByLead.values()].sort((a, b) => {
    const leadDelta = (leadOrder.get(a.leadId) ?? 0) - (leadOrder.get(b.leadId) ?? 0);
    if (leadDelta !== 0) return leadDelta;
    return a.scheduledAt.getTime() - b.scheduledAt.getTime();
  });

  const base = nextSendWindowAt(new Date(), campaign);
  const batchSize = positiveInt(campaign.batchSize, 16);
  const batchIntervalMs = positiveInt(campaign.batchIntervalMinutes, 65) * 60_000;
  const slotIntervalMs = Math.max(1_000, Math.floor(batchIntervalMs / batchSize));
  for (const [index, job] of jobsToPrioritize.entries()) {
    await db
      .update(emailSendJobsTable)
      .set({
        scheduledAt: nextSendWindowAt(new Date(base.getTime() + index * slotIntervalMs), campaign),
        errorMessage: "Prioritized for next available sending slot",
      })
      .where(eq(emailSendJobsTable.id, job.id));
  }

  return {
    campaignId,
    requestedLeads: targetLeadIds.length,
    prioritizedJobs: jobsToPrioritize.length,
    missingEmails: [...missingEmails],
    scheduledFrom: jobsToPrioritize.length > 0 ? base.toISOString() : null,
  };
}

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  campaignsTable,
  campaignLeadsTable,
  db,
  emailAccountsTable,
  emailSendJobsTable,
  leadLabelsTable,
  leadsTable,
  sequenceStepsTable,
  sequenceStepVariantsTable,
} from "@workspace/db";
import { getSendableAccounts } from "./account-rotation";
import { nextSendWindowAt } from "./sending-window";

const DAY_MS = 24 * 60 * 60 * 1000;

function clampPositiveInt(value: unknown, fallback: number, max = 10_000): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(Math.max(1, Math.floor(numberValue)), max);
}

function campaignBatchSettings(campaign: Pick<typeof campaignsTable.$inferSelect, "batchSize" | "batchIntervalMinutes">): { batchSize: number; batchIntervalMs: number } {
  return {
    batchSize: clampPositiveInt(campaign.batchSize, 25),
    batchIntervalMs: clampPositiveInt(campaign.batchIntervalMinutes, 60, 24 * 60) * 60 * 1000,
  };
}

type CampaignScheduleSettings = Pick<
  typeof campaignsTable.$inferSelect,
  "batchSize" | "batchIntervalMinutes" | "sendWindowStart" | "sendWindowEnd" | "sendWindowTimezone" | "sendWindowDays"
>;

function firstScheduledTimeForLead(
  baseTime: number,
  leadIndex: number,
  campaign: CampaignScheduleSettings,
): Date {
  const { batchSize, batchIntervalMs } = campaignBatchSettings(campaign);
  const batchIndex = Math.floor(leadIndex / batchSize);
  const slotIndex = leadIndex % batchSize;
  const slotOffsetMs = Math.floor((batchIntervalMs / batchSize) * slotIndex);
  return nextSendWindowAt(new Date(baseTime + batchIndex * batchIntervalMs + slotOffsetMs), campaign);
}

function followUpScheduledTime(previousStepAt: Date, delayDays: number, campaign: CampaignScheduleSettings): Date {
  return nextSendWindowAt(new Date(previousStepAt.getTime() + delayDays * DAY_MS), campaign);
}

function scheduledTimesForLead(
  baseTime: number,
  leadIndex: number,
  steps: Array<typeof sequenceStepsTable.$inferSelect>,
  campaign: CampaignScheduleSettings,
): Map<number, Date> {
  const scheduledByStepId = new Map<number, Date>();
  let previousStepAt: Date | null = null;
  for (const [stepIndex, step] of steps.entries()) {
    const scheduledAt: Date = stepIndex === 0
      ? firstScheduledTimeForLead(baseTime, leadIndex, campaign)
      : followUpScheduledTime(previousStepAt!, step.delayDays, campaign);
    scheduledByStepId.set(step.id, scheduledAt);
    previousStepAt = scheduledAt;
  }
  return scheduledByStepId;
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values.filter((value) => Number.isFinite(value) && value > 0)));
}

async function assignMissingTwoWayVariantLabels(
  steps: Array<typeof sequenceStepsTable.$inferSelect>,
  leadIds: number[],
): Promise<Map<string, typeof sequenceStepVariantsTable.$inferSelect>> {
  const chosenByLeadStep = new Map<string, typeof sequenceStepVariantsTable.$inferSelect>();
  if (leadIds.length === 0 || steps.length === 0) return chosenByLeadStep;

  const variants = await db
    .select()
    .from(sequenceStepVariantsTable)
    .where(inArray(sequenceStepVariantsTable.stepId, steps.map((step) => step.id)))
    .orderBy(asc(sequenceStepVariantsTable.stepId), desc(sequenceStepVariantsTable.priority), asc(sequenceStepVariantsTable.id));

  const variantsByStepId = new Map<number, Array<typeof sequenceStepVariantsTable.$inferSelect>>();
  for (const variant of variants) {
    const list = variantsByStepId.get(variant.stepId) ?? [];
    list.push(variant);
    variantsByStepId.set(variant.stepId, list);
  }

  const leadLabels = await db
    .select({ leadId: leadLabelsTable.leadId, labelId: leadLabelsTable.labelId })
    .from(leadLabelsTable)
    .where(inArray(leadLabelsTable.leadId, leadIds));

  const labelsByLeadId = new Map<number, Set<number>>();
  for (const label of leadLabels) {
    const set = labelsByLeadId.get(label.leadId) ?? new Set<number>();
    set.add(label.labelId);
    labelsByLeadId.set(label.leadId, set);
  }

  const labelsToInsert: Array<typeof leadLabelsTable.$inferInsert> = [];
  for (const step of steps) {
    const stepVariants = variantsByStepId.get(step.id) ?? [];
    if (stepVariants.length !== 2) continue;

    const variantLabelIds = new Set(stepVariants.map((variant) => variant.labelId));
    const unassignedLeadIds = leadIds.filter((leadId) => {
      const labels = labelsByLeadId.get(leadId);
      if (!labels) return true;
      return !Array.from(variantLabelIds).some((labelId) => labels.has(labelId));
    });
    const variantASize = Math.ceil(unassignedLeadIds.length / 2);

    for (const [index, leadId] of unassignedLeadIds.entries()) {
      const variant = index < variantASize ? stepVariants[0]! : stepVariants[1]!;
      chosenByLeadStep.set(`${leadId}:${step.id}`, variant);
      labelsToInsert.push({ leadId, labelId: variant.labelId });
      const labels = labelsByLeadId.get(leadId) ?? new Set<number>();
      labels.add(variant.labelId);
      labelsByLeadId.set(leadId, labels);
    }

    for (const leadId of leadIds) {
      if (chosenByLeadStep.has(`${leadId}:${step.id}`)) continue;
      const labels = labelsByLeadId.get(leadId);
      const matching = stepVariants.find((variant) => labels?.has(variant.labelId));
      if (matching) chosenByLeadStep.set(`${leadId}:${step.id}`, matching);
    }
  }

  if (labelsToInsert.length > 0) {
    await db.insert(leadLabelsTable).values(labelsToInsert).onConflictDoNothing();
  }

  return chosenByLeadStep;
}

export async function enqueueMissingCampaignJobs(
  campaignId: number,
  options: { leadIds?: number[] } = {},
): Promise<{
  campaign: typeof campaignsTable.$inferSelect;
  activeLeadCount: number;
  jobsCreated: number;
}> {
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
  if (!campaign) throw new Error("Campaign not found");

  const steps = await db
    .select()
    .from(sequenceStepsTable)
    .where(eq(sequenceStepsTable.campaignId, campaignId))
    .orderBy(asc(sequenceStepsTable.stepNumber));
  if (steps.length === 0) throw new Error("Add at least one sequence step before launching");

  const restrictLeadIds = options.leadIds ? uniqueNumbers(options.leadIds) : [];
  const leadWhere = restrictLeadIds.length > 0
    ? and(eq(campaignLeadsTable.campaignId, campaignId), inArray(campaignLeadsTable.leadId, restrictLeadIds))
    : eq(campaignLeadsTable.campaignId, campaignId);

  const leadRows = await db
    .select({ lead: leadsTable })
    .from(campaignLeadsTable)
    .innerJoin(leadsTable, eq(campaignLeadsTable.leadId, leadsTable.id))
    .where(leadWhere);
  const leads = Array.from(
    new Map(
      leadRows
        .map((r) => r.lead)
        .filter((lead) => lead.status === "active")
        .map((lead) => [lead.id, lead] as const),
    ).values(),
  );
  if (leads.length === 0) throw new Error("Add at least one active lead before launching");

  const sendable = await getSendableAccounts();
  if (sendable.length === 0) throw new Error("Connect at least one email account with SMTP credentials before launching");

  const existingJobs = await db
    .select({ leadId: emailSendJobsTable.leadId, stepId: emailSendJobsTable.stepId, status: emailSendJobsTable.status })
    .from(emailSendJobsTable)
    .where(eq(emailSendJobsTable.campaignId, campaignId));
  const existingKeys = new Set(
    existingJobs
      .filter((job) => job.status !== "failed" && job.status !== "skipped")
      .map((job) => `${job.leadId}:${job.stepId}`),
  );

  const variantByLeadStep = await assignMissingTwoWayVariantLabels(steps, leads.map((lead) => lead.id));

  const wallNow = Date.now();
  const scheduledStart = campaign.scheduledStartAt ? campaign.scheduledStartAt.getTime() : 0;
  const now = scheduledStart > wallNow ? scheduledStart : wallNow;
  const jobs: Array<typeof emailSendJobsTable.$inferInsert> = [];
  let accountIndex = existingJobs.length;

  for (const [leadIndex, lead] of leads.entries()) {
    const account = sendable[accountIndex % sendable.length]!;
    accountIndex++;
    const scheduledByStepId = scheduledTimesForLead(now, leadIndex, steps, campaign);
    for (const step of steps) {
      const key = `${lead.id}:${step.id}`;
      if (existingKeys.has(key)) continue;
      const variant = variantByLeadStep.get(key);
      jobs.push({
        campaignId,
        leadId: lead.id,
        stepId: step.id,
        accountId: account.id,
        variantId: variant?.id ?? null,
        variantName: variant?.name ?? null,
        scheduledAt: scheduledByStepId.get(step.id)!,
        status: "pending",
      });
    }
  }

  if (jobs.length > 0) {
    await db.insert(emailSendJobsTable).values(jobs);
  }

  return { campaign, activeLeadCount: leads.length, jobsCreated: jobs.length };
}

import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, leadsTable, campaignLeadsTable, campaignsTable, labelsTable, leadLabelsTable, emailSendJobsTable, sequenceStepsTable, clickEventsTable, inboxMessagesTable, type Lead, type Label } from "@workspace/db";
import {
  CreateLeadBody,
  UpdateLeadBody,
  UpdateLeadParams,
  DeleteLeadParams,
  ListCampaignLeadsParams,
  AddLeadsToCampaignParams,
  AddLeadsToCampaignBody,
  RemoveLeadFromCampaignParams,
  BulkImportLeadsBody,
} from "@workspace/api-zod";
import { parseLeadsCsv, type LeadRow } from "../lib/csv";
import { classifyReply } from "../lib/reply-classifier";
import { enqueueMissingCampaignJobs } from "../lib/campaign-enqueue";

const router: IRouter = Router();

async function attachLabels<T extends Pick<Lead, "id">>(leads: T[]): Promise<(T & { labels: Label[] })[]> {
  if (leads.length === 0) return [];
  const ids = leads.map((l) => l.id);
  const rows = await db
    .select({
      leadId: leadLabelsTable.leadId,
      id: labelsTable.id,
      name: labelsTable.name,
      color: labelsTable.color,
      createdAt: labelsTable.createdAt,
    })
    .from(leadLabelsTable)
    .innerJoin(labelsTable, eq(leadLabelsTable.labelId, labelsTable.id))
    .where(inArray(leadLabelsTable.leadId, ids));
  const byLead = new Map<number, Label[]>();
  for (const r of rows) {
    const { leadId, ...lbl } = r;
    const list = byLead.get(leadId) ?? [];
    list.push(lbl as Label);
    byLead.set(leadId, list);
  }
  return leads.map((l) => ({ ...l, labels: byLead.get(l.id) ?? [] }));
}

function isoDate(value: Date | string | number | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function latestIso(values: Array<Date | string | number | null | undefined>): string | null {
  let latest: number | null = null;
  for (const value of values) {
    if (!value) continue;
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (!Number.isFinite(time)) continue;
    if (latest === null || time > latest) latest = time;
  }
  return latest === null ? null : new Date(latest).toISOString();
}

function sentLike(job: typeof emailSendJobsTable.$inferSelect): boolean {
  return job.status === "sent" || !!job.sentAt;
}

async function sequenceProgressForCampaign(campaignId: number, leadIds: number[]) {
  if (leadIds.length === 0) return new Map<number, unknown>();

  const [steps, jobs] = await Promise.all([
    db
      .select()
      .from(sequenceStepsTable)
      .where(eq(sequenceStepsTable.campaignId, campaignId)),
    db
      .select()
      .from(emailSendJobsTable)
      .where(and(eq(emailSendJobsTable.campaignId, campaignId), inArray(emailSendJobsTable.leadId, leadIds))),
  ]);

  const sortedSteps = [...steps].sort((a, b) => a.stepNumber - b.stepNumber);
  const stepById = new Map(sortedSteps.map((step) => [step.id, step]));
  const jobsByLead = new Map<number, typeof jobs>();
  for (const job of jobs) {
    const list = jobsByLead.get(job.leadId) ?? [];
    list.push(job);
    jobsByLead.set(job.leadId, list);
  }

  const result = new Map<number, unknown>();
  for (const leadId of leadIds) {
    const leadJobs = jobsByLead.get(leadId) ?? [];
    const sortedJobs = [...leadJobs].sort((a, b) => {
      const aStep = stepById.get(a.stepId)?.stepNumber ?? Number.MAX_SAFE_INTEGER;
      const bStep = stepById.get(b.stepId)?.stepNumber ?? Number.MAX_SAFE_INTEGER;
      if (aStep !== bStep) return aStep - bStep;
      const aTime = a.scheduledAt ? new Date(a.scheduledAt).getTime() : 0;
      const bTime = b.scheduledAt ? new Date(b.scheduledAt).getTime() : 0;
      return aTime - bTime;
    });

    const sentJobs = sortedJobs.filter(sentLike);
    const sentStepNumbers = sentJobs
      .map((job) => stepById.get(job.stepId)?.stepNumber)
      .filter((stepNumber): stepNumber is number => typeof stepNumber === "number");
    const currentStepNumber = sentStepNumbers.length > 0 ? Math.max(...sentStepNumbers) : 0;
    const pendingJobs = sortedJobs
      .filter((job) => job.status === "pending" || job.status === "in_progress")
      .sort((a, b) => {
        const aTime = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Number.POSITIVE_INFINITY;
        const bTime = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Number.POSITIVE_INFINITY;
        return aTime - bTime;
      });
    const nextJob = pendingJobs[0] ?? null;
    const nextStep = nextJob ? stepById.get(nextJob.stepId) : null;
    const currentStep = currentStepNumber > 0
      ? sortedSteps.find((step) => step.stepNumber === currentStepNumber) ?? null
      : null;

    const bounced = sortedJobs.some((job) => !!job.bounceKind);
    const replied = sortedJobs.some((job) => !!job.repliedAt);
    const inProgress = sortedJobs.some((job) => job.status === "in_progress");
    const failed = sortedJobs.some((job) => job.status === "failed");
    const completed = sortedSteps.length > 0 && sentStepNumbers.length >= sortedSteps.length;
    const queued = sortedJobs.length > 0;
    const sequenceStatus = bounced
      ? "bounced"
      : replied
        ? "replied"
        : completed
          ? "completed"
          : inProgress
            ? "sending"
            : nextJob
              ? "scheduled"
              : failed
                ? "failed"
                : queued
                  ? "waiting"
                  : "not_queued";

    result.set(leadId, {
      status: sequenceStatus,
      currentStepNumber,
      currentStepSubject: currentStep?.subject ?? null,
      nextStepNumber: nextStep?.stepNumber ?? null,
      nextStepSubject: nextStep?.subject ?? null,
      nextScheduledAt: isoDate(nextJob?.scheduledAt),
      totalSteps: sortedSteps.length,
      sentSteps: new Set(sentJobs.map((job) => job.stepId)).size,
      queuedSteps: sortedJobs.length,
      opened: sortedJobs.some((job) => job.openCount > 0),
      clicked: sortedJobs.some((job) => job.clickCount > 0),
      replied,
      bounced,
      failed,
      lastSentAt: latestIso(sortedJobs.map((job) => job.sentAt)),
      lastOpenedAt: latestIso(sortedJobs.map((job) => job.firstOpenedAt)),
      lastClickedAt: latestIso(sortedJobs.map((job) => job.firstClickedAt)),
      lastRepliedAt: latestIso(sortedJobs.map((job) => job.repliedAt)),
      lastEventAt: latestIso(sortedJobs.flatMap((job) => [job.sentAt, job.firstOpenedAt, job.firstClickedAt, job.repliedAt, job.scheduledAt])),
    });
  }

  return result;
}

router.get("/leads", async (_req, res): Promise<void> => {
  const leads = await db.select().from(leadsTable).orderBy(leadsTable.createdAt);
  res.json(await attachLabels(leads));
});

router.post("/leads/bulk", async (req, res): Promise<void> => {
  let rawLeads: LeadRow[] = [];
  let campaignId: number | undefined;

  const contentType = (req.headers["content-type"] ?? "").toLowerCase();
  const isCsvUpload = contentType.includes("text/csv") || contentType.includes("application/csv");

  if (isCsvUpload) {
    // Direct CSV upload via:
    //   curl -X POST -H "Content-Type: text/csv" --data-binary @leads.csv \
    //        '<host>/api/leads/bulk?campaignId=123'
    const csvText = typeof req.body === "string" ? req.body : "";
    if (!csvText.trim()) {
      res.status(400).json({ error: "Empty CSV body" });
      return;
    }
    const { leads, error } = parseLeadsCsv(csvText);
    if (error) {
      res.status(400).json({ error });
      return;
    }
    rawLeads = leads;

    const rawCampaignId = req.query["campaignId"];
    if (typeof rawCampaignId === "string" && rawCampaignId.length > 0) {
      // Strict: must be a positive integer with no extra characters.
      if (!/^[1-9]\d*$/.test(rawCampaignId)) {
        res.status(400).json({ error: "campaignId must be a positive integer" });
        return;
      }
      campaignId = parseInt(rawCampaignId, 10);
    }
  } else {
    const parsed = BulkImportLeadsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const hasLeads = Array.isArray(parsed.data.leads) && parsed.data.leads.length > 0;
    const hasCsv = typeof parsed.data.csvText === "string" && parsed.data.csvText.trim().length > 0;
    if (!hasLeads && !hasCsv) {
      res.status(400).json({ error: "Provide either 'leads' or 'csvText'" });
      return;
    }
    if (hasCsv) {
      const { leads, error } = parseLeadsCsv(parsed.data.csvText!);
      if (error) {
        res.status(400).json({ error });
        return;
      }
      rawLeads = leads;
    } else {
      rawLeads = parsed.data.leads as LeadRow[];
    }
    campaignId = parsed.data.campaignId ?? undefined;
  }

  if (rawLeads.length === 0) {
    res.status(400).json({ error: "No valid leads found. Make sure the CSV has an email column and at least one valid email address." });
    return;
  }

  let imported = 0;
  let skipped = 0;
  const leadIds: number[] = [];

  for (const lead of rawLeads) {
    if (!lead.email?.includes("@")) { skipped++; continue; }
    try {
      const [row] = await db
        .insert(leadsTable)
        .values({
          email: lead.email.toLowerCase().trim(),
          firstName: lead.firstName || null,
          lastName: lead.lastName || null,
          company: lead.company || null,
          title: lead.title || null,
          roleTitle: lead.roleTitle || null,
          website: lead.website || null,
          phone: lead.phone || null,
        })
        .onConflictDoNothing()
        .returning();
      if (row) { imported++; leadIds.push(row.id); } else { skipped++; }
    } catch { skipped++; }
  }

  if (campaignId !== undefined && leadIds.length > 0) {
    const rows = leadIds.map((lid) => ({ campaignId: campaignId!, leadId: lid }));
    await db.insert(campaignLeadsTable).values(rows).onConflictDoNothing();
    const count = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.campaignId, campaignId));
    await db.update(campaignsTable).set({ leadsCount: count.length }).where(eq(campaignsTable.id, campaignId));
  }

  // Apply labels to all imported leads, if requested.
  const labelIds: number[] = (() => {
    if (isCsvUpload) {
      const raw = req.query["labelIds"];
      if (typeof raw === "string" && raw.length > 0) {
        return raw.split(",").map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n) && n > 0);
      }
      return [];
    }
    const body = req.body as { labelIds?: unknown };
    return Array.isArray(body?.labelIds)
      ? (body.labelIds as unknown[]).filter((n): n is number => typeof n === "number" && Number.isFinite(n))
      : [];
  })();

  if (labelIds.length > 0 && leadIds.length > 0) {
    const validLabels = await db.select({ id: labelsTable.id }).from(labelsTable).where(inArray(labelsTable.id, labelIds));
    const validIds = validLabels.map((v) => v.id);
    if (validIds.length > 0) {
      const linkRows = leadIds.flatMap((lid) => validIds.map((lblId) => ({ leadId: lid, labelId: lblId })));
      await db.insert(leadLabelsTable).values(linkRows).onConflictDoNothing();
    }
  }

  let jobsCreated = 0;
  if (campaignId !== undefined && leadIds.length > 0) {
    const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, campaignId));
    if (campaign?.status === "active") {
      try {
        jobsCreated = (await enqueueMissingCampaignJobs(campaignId, { leadIds })).jobsCreated;
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Failed to queue imported campaign leads" });
        return;
      }
    }
  }

  res.json({ imported, skipped, total: rawLeads.length, leadIds, jobsCreated });
});

router.post("/leads", async (req, res): Promise<void> => {
  const parsed = CreateLeadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const email = parsed.data.email.toLowerCase().trim();
  if (!email.includes("@")) {
    res.status(400).json({ error: "A valid email address is required" });
    return;
  }

  const [existing] = await db.select({ id: leadsTable.id }).from(leadsTable).where(eq(leadsTable.email, email)).limit(1);
  if (existing) {
    res.status(409).json({ error: `Lead already exists for ${email}` });
    return;
  }

  const [lead] = await db.insert(leadsTable).values({
    ...parsed.data,
    email,
    firstName: parsed.data.firstName?.trim() || null,
    lastName: parsed.data.lastName?.trim() || null,
    company: parsed.data.company?.trim() || null,
    title: parsed.data.title?.trim() || null,
    roleTitle: parsed.data.roleTitle?.trim() || null,
    website: parsed.data.website?.trim() || null,
    phone: parsed.data.phone?.trim() || null,
  }).returning();
  res.status(201).json({ ...lead, labels: [] });
});

router.patch("/leads/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateLeadParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateLeadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [lead] = await db.update(leadsTable).set(parsed.data).where(eq(leadsTable.id, params.data.id)).returning();
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  const [withLabels] = await attachLabels([lead]);
  res.json(withLabels);
});

router.delete("/leads/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteLeadParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [lead] = await db.delete(leadsTable).where(eq(leadsTable.id, params.data.id)).returning();
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  res.sendStatus(204);
});

// Per-lead activity: which campaigns they're in, where they are in the sequence,
// and per-campaign engagement stats (sent / opened / clicked / replied / bounced).
router.get("/leads/:id/activity", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const leadId = parseInt(raw, 10);
  if (!Number.isFinite(leadId) || leadId <= 0) {
    res.status(400).json({ error: "Invalid lead id" });
    return;
  }
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId));
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  // All campaigns this lead is enrolled in.
  const enrollments = await db
    .select({ campaign: campaignsTable })
    .from(campaignLeadsTable)
    .innerJoin(campaignsTable, eq(campaignLeadsTable.campaignId, campaignsTable.id))
    .where(eq(campaignLeadsTable.leadId, leadId));

  const campaignIds = enrollments.map((e) => e.campaign.id);

  const jobs = campaignIds.length > 0
    ? await db
        .select()
        .from(emailSendJobsTable)
        .where(and(eq(emailSendJobsTable.leadId, leadId), inArray(emailSendJobsTable.campaignId, campaignIds)))
    : [];

  const maxDate = (vals: Array<Date | string | null | undefined>): string | null => {
    let best: number | null = null;
    let bestRaw: Date | string | null = null;
    for (const v of vals) {
      if (!v) continue;
      const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
      if (!Number.isFinite(t)) continue;
      if (best === null || t > best) { best = t; bestRaw = v; }
    }
    if (bestRaw === null) return null;
    return bestRaw instanceof Date ? bestRaw.toISOString() : new Date(bestRaw).toISOString();
  };

  const steps = campaignIds.length > 0
    ? await db.select().from(sequenceStepsTable).where(inArray(sequenceStepsTable.campaignId, campaignIds))
    : [];
  const clicks = campaignIds.length > 0
    ? await db.select().from(clickEventsTable).where(and(eq(clickEventsTable.leadId, leadId), inArray(clickEventsTable.campaignId, campaignIds)))
    : [];
  const replies = campaignIds.length > 0
    ? await db.select().from(inboxMessagesTable).where(and(eq(inboxMessagesTable.leadId, leadId), inArray(inboxMessagesTable.campaignId, campaignIds)))
    : [];

  const stepsByCampaign = new Map<number, typeof steps>();
  for (const s of steps) {
    const list = stepsByCampaign.get(s.campaignId) ?? [];
    list.push(s);
    stepsByCampaign.set(s.campaignId, list);
  }
  for (const [, list] of stepsByCampaign) list.sort((a, b) => a.stepNumber - b.stepNumber);

  const isSent = (j: typeof jobs[number]) => j.status === "sent" || !!j.sentAt;

  const activity = enrollments.map(({ campaign }) => {
    const campaignJobs = jobs.filter((j) => j.campaignId === campaign.id);
    const sent = campaignJobs.filter(isSent).length;
    const opened = campaignJobs.filter((j) => j.openCount > 0).length;
    const clicked = campaignJobs.filter((j) => j.clickCount > 0).length;
    const replied = campaignJobs.filter((j) => j.repliedAt).length;
    const bounced = campaignJobs.filter((j) => j.bounceKind).length;

    const campaignSteps = stepsByCampaign.get(campaign.id) ?? [];
    const totalSteps = campaignSteps.length;

    // currentStep mirrors `sent` logic so they don't drift.
    const sentStepIds = new Set(campaignJobs.filter(isSent).map((j) => j.stepId));
    const sentStepNumbers = campaignSteps
      .filter((s) => sentStepIds.has(s.id))
      .map((s) => s.stepNumber);
    const currentStep = sentStepNumbers.length > 0 ? Math.max(...sentStepNumbers) : 0;

    // Next step = earliest upcoming pending/in_progress job (ASC by scheduledAt).
    const pendingJob = campaignJobs
      .filter((j) => j.status === "pending" || j.status === "in_progress")
      .sort((a, b) => {
        const at = a.scheduledAt ? new Date(a.scheduledAt).getTime() : Number.POSITIVE_INFINITY;
        const bt = b.scheduledAt ? new Date(b.scheduledAt).getTime() : Number.POSITIVE_INFINITY;
        return at - bt;
      })[0];
    const nextStep = pendingJob ? campaignSteps.find((s) => s.id === pendingJob.stepId) : null;

    // Each last* is the MAX of its own timestamp field, not picked from a single ordering.
    const lastSent = maxDate(campaignJobs.map((j) => j.sentAt));
    const lastOpened = maxDate(campaignJobs.map((j) => j.firstOpenedAt));
    const lastClicked = maxDate(campaignJobs.map((j) => j.firstClickedAt));
    const lastReplied = maxDate(campaignJobs.map((j) => j.repliedAt));

    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      campaignStatus: campaign.status,
      currentStep,
      totalSteps,
      nextStepNumber: nextStep?.stepNumber ?? null,
      nextScheduledAt: pendingJob?.scheduledAt ?? null,
      sent,
      opened,
      clicked,
      replied,
      bounced,
      openRate: sent > 0 ? parseFloat(((opened / sent) * 100).toFixed(1)) : 0,
      clickRate: sent > 0 ? parseFloat(((clicked / sent) * 100).toFixed(1)) : 0,
      replyRate: sent > 0 ? parseFloat(((replied / sent) * 100).toFixed(1)) : 0,
      bounceRate: sent > 0 ? parseFloat(((bounced / sent) * 100).toFixed(1)) : 0,
      lastSentAt: lastSent,
      lastOpenedAt: lastOpened,
      lastClickedAt: lastClicked,
      lastRepliedAt: lastReplied,
    };
  });

  const campaignsById = new Map(enrollments.map((e) => [e.campaign.id, e.campaign]));
  const stepsById = new Map(steps.map((s) => [s.id, s]));
  const timeline = [
    ...jobs.flatMap((job) => {
      const campaign = campaignsById.get(job.campaignId);
      const step = stepsById.get(job.stepId);
      const base = {
        campaignId: job.campaignId,
        campaignName: campaign?.name ?? `Campaign #${job.campaignId}`,
        stepNumber: step?.stepNumber ?? null,
        subject: step?.subject ?? "",
      };
      const rows = [{
        ...base,
        eventType: job.status === "failed" ? "failed" : job.status === "skipped" ? "skipped" : "scheduled",
        occurredAt: job.scheduledAt ? new Date(job.scheduledAt).toISOString() : null,
        detail: job.errorMessage ?? `Step ${step?.stepNumber ?? "?"} queued`,
      }];
      if (job.sentAt) rows.push({ ...base, eventType: "sent", occurredAt: new Date(job.sentAt).toISOString(), detail: step?.subject ?? "" });
      if (job.firstOpenedAt) rows.push({ ...base, eventType: "opened", occurredAt: new Date(job.firstOpenedAt).toISOString(), detail: `${job.openCount} open${job.openCount === 1 ? "" : "s"}` });
      if (job.firstClickedAt) rows.push({ ...base, eventType: "clicked", occurredAt: new Date(job.firstClickedAt).toISOString(), detail: `${job.clickCount} click${job.clickCount === 1 ? "" : "s"}` });
      if (job.repliedAt) rows.push({ ...base, eventType: "replied", occurredAt: new Date(job.repliedAt).toISOString(), detail: "Reply received" });
      if (job.bounceKind) rows.push({ ...base, eventType: "bounced", occurredAt: new Date(job.sentAt ?? job.scheduledAt).toISOString(), detail: `${job.bounceKind} bounce` });
      return rows;
    }),
    ...clicks.map((click) => {
      const campaign = campaignsById.get(click.campaignId);
      return {
        campaignId: click.campaignId,
        campaignName: campaign?.name ?? `Campaign #${click.campaignId}`,
        stepNumber: null,
        subject: "",
        eventType: "link_click",
        occurredAt: new Date(click.clickedAt).toISOString(),
        detail: click.url,
      };
    }),
    ...replies.map((reply) => {
      const campaign = reply.campaignId ? campaignsById.get(reply.campaignId) : null;
      const classification = classifyReply(reply);
      return {
        campaignId: reply.campaignId,
        campaignName: campaign?.name ?? (reply.campaignId ? `Campaign #${reply.campaignId}` : ""),
        stepNumber: null,
        subject: reply.subject,
        eventType: classification.category === "bounce" ? "bounce_reply" : "reply",
        occurredAt: new Date(reply.receivedAt).toISOString(),
        detail: classification.category,
      };
    }),
  ].filter((row) => row.occurredAt).sort((a, b) => new Date(b.occurredAt!).getTime() - new Date(a.occurredAt!).getTime());

  res.json({ leadId, campaigns: activity, timeline });
});

router.get("/campaigns/:id/leads", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = ListCampaignLeadsParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const campaignLeads = await db
    .select({ lead: leadsTable })
    .from(campaignLeadsTable)
    .innerJoin(leadsTable, eq(campaignLeadsTable.leadId, leadsTable.id))
    .where(eq(campaignLeadsTable.campaignId, params.data.id));
  const leads = campaignLeads.map(r => r.lead);
  const progressByLead = await sequenceProgressForCampaign(params.data.id, leads.map((lead) => lead.id));
  const withLabels = await attachLabels(leads);
  res.json(withLabels.map((lead) => ({
    ...lead,
    sequenceProgress: progressByLead.get(lead.id) ?? null,
  })));
});

router.post("/campaigns/:id/leads", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = AddLeadsToCampaignParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = AddLeadsToCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = parsed.data.leadIds.map(leadId => ({ campaignId: params.data.id, leadId }));
  await db.insert(campaignLeadsTable).values(rows).onConflictDoNothing();
  const count = await db
    .select()
    .from(campaignLeadsTable)
    .where(eq(campaignLeadsTable.campaignId, params.data.id));
  const [campaign] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, params.data.id));
  let jobsCreated = 0;
  if (campaign?.status === "active") {
    try {
      const result = await enqueueMissingCampaignJobs(params.data.id, { leadIds: parsed.data.leadIds });
      jobsCreated = result.jobsCreated;
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to queue new campaign leads" });
      return;
    }
  }
  await db.update(campaignsTable).set({ leadsCount: count.length }).where(eq(campaignsTable.id, params.data.id));
  res.json({ added: parsed.data.leadIds.length, jobsCreated });
});

router.delete("/campaigns/:id/leads/:leadId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawLeadId = Array.isArray(req.params.leadId) ? req.params.leadId[0] : req.params.leadId;
  const params = RemoveLeadFromCampaignParams.safeParse({ id: parseInt(rawId, 10), leadId: parseInt(rawLeadId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(campaignLeadsTable).where(
    and(
      eq(campaignLeadsTable.campaignId, params.data.id),
      eq(campaignLeadsTable.leadId, params.data.leadId)
    )
  );
  const count = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.campaignId, params.data.id));
  await db.update(campaignsTable).set({ leadsCount: count.length }).where(eq(campaignsTable.id, params.data.id));
  res.sendStatus(204);
});

export default router;

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, campaignsTable, sequenceStepsTable, sequenceStepVariantsTable, campaignLeadsTable, leadsTable, leadListsTable, listLeadsTable } from "@workspace/db";
import { attachmentsJson } from "../../lib/email-attachments";

const router: IRouter = Router();

// GET /api/v1/campaigns
router.get("/campaigns", async (req, res): Promise<void> => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 500);
  const offset = parseInt(String(req.query.offset ?? "0"), 10);
  const all = await db.select().from(campaignsTable).orderBy(campaignsTable.createdAt);
  res.json({ data: all.slice(offset, offset + limit), total: all.length, limit, offset });
});

// GET /api/v1/campaigns/:id
router.get("/campaigns/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const rows = await db.select().from(campaignsTable).where(eq(campaignsTable.id, id));
  if (!rows[0]) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Campaign not found" } }); return; }
  const steps = await db.select().from(sequenceStepsTable).where(eq(sequenceStepsTable.campaignId, id)).orderBy(sequenceStepsTable.stepNumber);
  const variants = steps.length > 0 ? await db.select().from(sequenceStepVariantsTable) : [];
  res.json({
    ...rows[0],
    steps: steps.map((step) => ({
      ...step,
      variants: variants.filter((variant) => variant.stepId === step.id),
    })),
  });
});

// POST /api/v1/campaigns
router.post("/campaigns", async (req, res): Promise<void> => {
  const { name, fromName, replyTo, dailyLimit, batchSize, batchIntervalMinutes, sendWindowStart, sendWindowEnd, sendWindowTimezone, sendWindowDays, trackOpens, trackClicks } = req.body ?? {};
  if (!name) { res.status(400).json({ error: { code: "INVALID_INPUT", message: "'name' is required" } }); return; }
  const [row] = await db.insert(campaignsTable).values({
    name,
    fromName: fromName ?? null,
    replyTo: replyTo ?? null,
    dailyLimit: dailyLimit ?? null,
    batchSize: batchSize ?? 5,
    batchIntervalMinutes: batchIntervalMinutes ?? 90,
    sendWindowStart: sendWindowStart ?? "07:00",
    sendWindowEnd: sendWindowEnd ?? "19:00",
    sendWindowTimezone: sendWindowTimezone ?? "Australia/Sydney",
    sendWindowDays: sendWindowDays ?? "mon,tue,wed,thu,fri",
    trackOpens: trackOpens !== false,
    trackClicks: trackClicks !== false,
  }).returning();
  res.status(201).json(row);
});

// PATCH /api/v1/campaigns/:id  (update settings)
router.patch("/campaigns/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { name, fromName, replyTo, dailyLimit, batchSize, batchIntervalMinutes, sendWindowStart, sendWindowEnd, sendWindowTimezone, sendWindowDays, trackOpens, trackClicks } = req.body ?? {};
  const update: Record<string, unknown> = {};
  if (name !== undefined) update.name = name;
  if (fromName !== undefined) update.fromName = fromName;
  if (replyTo !== undefined) update.replyTo = replyTo;
  if (dailyLimit !== undefined) update.dailyLimit = dailyLimit;
  if (batchSize !== undefined) update.batchSize = batchSize;
  if (batchIntervalMinutes !== undefined) update.batchIntervalMinutes = batchIntervalMinutes;
  if (sendWindowStart !== undefined) update.sendWindowStart = sendWindowStart;
  if (sendWindowEnd !== undefined) update.sendWindowEnd = sendWindowEnd;
  if (sendWindowTimezone !== undefined) update.sendWindowTimezone = sendWindowTimezone;
  if (sendWindowDays !== undefined) update.sendWindowDays = Array.isArray(sendWindowDays) ? sendWindowDays.join(",") : sendWindowDays;
  if (trackOpens !== undefined) update.trackOpens = trackOpens;
  if (trackClicks !== undefined) update.trackClicks = trackClicks;
  const [row] = await db.update(campaignsTable).set(update).where(eq(campaignsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Campaign not found" } }); return; }
  res.json(row);
});

// POST /api/v1/campaigns/:id/start
router.post("/campaigns/:id/start", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db.update(campaignsTable).set({ status: "active" }).where(eq(campaignsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Campaign not found" } }); return; }
  res.json({ id: row.id, status: row.status, message: "Campaign started" });
});

// POST /api/v1/campaigns/:id/pause
router.post("/campaigns/:id/pause", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db.update(campaignsTable).set({ status: "paused" }).where(eq(campaignsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Campaign not found" } }); return; }
  res.json({ id: row.id, status: row.status, message: "Campaign paused" });
});

// POST /api/v1/campaigns/:id/stop
router.post("/campaigns/:id/stop", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const [row] = await db.update(campaignsTable).set({ status: "completed" }).where(eq(campaignsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Campaign not found" } }); return; }
  res.json({ id: row.id, status: row.status, message: "Campaign stopped" });
});

// POST /api/v1/campaigns/:id/attach-list  — attach a lead list to campaign
router.post("/campaigns/:id/attach-list", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { listId } = req.body ?? {};
  if (!listId) { res.status(400).json({ error: { code: "INVALID_INPUT", message: "'listId' is required" } }); return; }

  const listRows = await db.select().from(leadListsTable).where(eq(leadListsTable.id, Number(listId)));
  if (!listRows[0]) { res.status(404).json({ error: { code: "NOT_FOUND", message: "List not found" } }); return; }

  const members = await db.select().from(listLeadsTable).where(eq(listLeadsTable.listId, Number(listId)));
  if (members.length > 0) {
    await db.insert(campaignLeadsTable).values(members.map(m => ({ campaignId: id, leadId: m.leadId }))).onConflictDoNothing();
  }

  const allCampaignLeads = await db.select().from(campaignLeadsTable).where(eq(campaignLeadsTable.campaignId, id));
  await db.update(campaignsTable).set({ leadsCount: allCampaignLeads.length }).where(eq(campaignsTable.id, id));

  res.json({ campaignId: id, listId: Number(listId), addedLeads: members.length, totalLeads: allCampaignLeads.length });
});

// ── Sequence steps ─────────────────────────────────────────────────────────

// GET /api/v1/campaigns/:id/sequence
router.get("/campaigns/:id/sequence", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const steps = await db.select().from(sequenceStepsTable).where(eq(sequenceStepsTable.campaignId, id)).orderBy(sequenceStepsTable.stepNumber);
  res.json({ data: steps, total: steps.length });
});

// PUT /api/v1/campaigns/:id/sequence — replace all steps
router.put("/campaigns/:id/sequence", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { steps } = req.body ?? {};
  if (!Array.isArray(steps)) { res.status(400).json({ error: { code: "INVALID_INPUT", message: "'steps' must be an array" } }); return; }

  const existingSteps = await db.select().from(sequenceStepsTable).where(eq(sequenceStepsTable.campaignId, id));
  for (const step of existingSteps) {
    await db.delete(sequenceStepVariantsTable).where(eq(sequenceStepVariantsTable.stepId, step.id));
  }
  await db.delete(sequenceStepsTable).where(eq(sequenceStepsTable.campaignId, id));

  const created = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (!s.subject || !s.body) continue;
    const [row] = await db.insert(sequenceStepsTable).values({ campaignId: id, stepNumber: i + 1, subject: s.subject, body: s.body, bodyType: s.bodyType ?? "text", attachmentsJson: attachmentsJson(s.attachments), delayDays: s.delayDays ?? 0 }).returning();
    created.push({ ...row, variants: [] });
  }
  res.json({ data: created, total: created.length });
});

// POST /api/v1/campaigns/:id/sequence — add a single step
router.post("/campaigns/:id/sequence", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { subject, body, bodyType, delayDays, attachments } = req.body ?? {};
  if (!subject || !body) { res.status(400).json({ error: { code: "INVALID_INPUT", message: "'subject' and 'body' are required" } }); return; }

  const existing = await db.select().from(sequenceStepsTable).where(eq(sequenceStepsTable.campaignId, id));
  const [row] = await db.insert(sequenceStepsTable).values({ campaignId: id, stepNumber: existing.length + 1, subject, body, bodyType: bodyType ?? "text", attachmentsJson: attachmentsJson(attachments), delayDays: delayDays ?? 0 }).returning();
  res.status(201).json(row);
});

export default router;

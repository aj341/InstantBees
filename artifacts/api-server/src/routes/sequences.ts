import { Router, type IRouter } from "express";
import { eq, and, count } from "drizzle-orm";
import { db, sequenceStepsTable } from "@workspace/db";
import {
  CreateSequenceBody,
  CreateSequenceParams,
  UpdateSequenceBody,
  UpdateSequenceParams,
  DeleteSequenceParams,
  ListSequencesParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/campaigns/:id/sequences", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = ListSequencesParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const steps = await db
    .select()
    .from(sequenceStepsTable)
    .where(eq(sequenceStepsTable.campaignId, params.data.id))
    .orderBy(sequenceStepsTable.stepNumber);
  res.json(steps);
});

router.post("/campaigns/:id/sequences", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = CreateSequenceParams.safeParse({ id: parseInt(rawId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateSequenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await db
    .select()
    .from(sequenceStepsTable)
    .where(eq(sequenceStepsTable.campaignId, params.data.id));
  const stepNumber = existing.length + 1;
  const [step] = await db
    .insert(sequenceStepsTable)
    .values({ ...parsed.data, campaignId: params.data.id, stepNumber })
    .returning();
  res.status(201).json(step);
});

router.patch("/campaigns/:id/sequences/:stepId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawStepId = Array.isArray(req.params.stepId) ? req.params.stepId[0] : req.params.stepId;
  const params = UpdateSequenceParams.safeParse({ id: parseInt(rawId, 10), stepId: parseInt(rawStepId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateSequenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [step] = await db
    .update(sequenceStepsTable)
    .set(parsed.data)
    .where(and(eq(sequenceStepsTable.id, params.data.stepId), eq(sequenceStepsTable.campaignId, params.data.id)))
    .returning();
  if (!step) {
    res.status(404).json({ error: "Step not found" });
    return;
  }
  res.json(step);
});

router.delete("/campaigns/:id/sequences/:stepId", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawStepId = Array.isArray(req.params.stepId) ? req.params.stepId[0] : req.params.stepId;
  const params = DeleteSequenceParams.safeParse({ id: parseInt(rawId, 10), stepId: parseInt(rawStepId, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [step] = await db
    .delete(sequenceStepsTable)
    .where(and(eq(sequenceStepsTable.id, params.data.stepId), eq(sequenceStepsTable.campaignId, params.data.id)))
    .returning();
  if (!step) {
    res.status(404).json({ error: "Step not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;

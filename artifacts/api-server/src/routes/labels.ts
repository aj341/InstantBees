import { Router, type IRouter } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, labelsTable, leadLabelsTable, leadsTable } from "@workspace/db";
import { CreateLabelBody, SetLeadLabelsBody, SetLeadLabelsParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/labels", async (_req, res): Promise<void> => {
  const rows = await db.select().from(labelsTable).orderBy(labelsTable.name);
  res.json(rows);
});

router.post("/labels", async (req, res): Promise<void> => {
  const parsed = CreateLabelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Label name required" });
    return;
  }
  try {
    const [row] = await db
      .insert(labelsTable)
      .values({ name, color: parsed.data.color || "#06b6d4" })
      .returning();
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: "Label with that name already exists" });
  }
});

router.delete("/labels/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid label id" });
    return;
  }
  await db.delete(leadLabelsTable).where(eq(leadLabelsTable.labelId, id));
  await db.delete(labelsTable).where(eq(labelsTable.id, id));
  res.sendStatus(204);
});

router.put("/leads/:id/labels", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = SetLeadLabelsParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = SetLeadLabelsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const leadId = params.data.id;

  const result = await db.transaction(async (tx) => {
    const [lead] = await tx.select().from(leadsTable).where(eq(leadsTable.id, leadId));
    if (!lead) return null;

    await tx.delete(leadLabelsTable).where(eq(leadLabelsTable.leadId, leadId));
    if (body.data.labelIds.length > 0) {
      const valid = await tx
        .select({ id: labelsTable.id })
        .from(labelsTable)
        .where(inArray(labelsTable.id, body.data.labelIds));
      const validIds = valid.map((v) => v.id);
      if (validIds.length > 0) {
        await tx
          .insert(leadLabelsTable)
          .values(validIds.map((labelId) => ({ leadId, labelId })))
          .onConflictDoNothing();
      }
    }

    const labels = await tx
      .select({
        id: labelsTable.id,
        name: labelsTable.name,
        color: labelsTable.color,
        createdAt: labelsTable.createdAt,
      })
      .from(leadLabelsTable)
      .innerJoin(labelsTable, eq(leadLabelsTable.labelId, labelsTable.id))
      .where(eq(leadLabelsTable.leadId, leadId));

    return { ...lead, labels };
  });

  if (!result) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }
  res.json(result);
});

export default router;

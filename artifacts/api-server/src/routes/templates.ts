import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, emailTemplatesTable } from "@workspace/db";
import { attachmentsJson } from "../lib/email-attachments";

const router: IRouter = Router();

// GET /api/templates
router.get("/templates", async (req, res): Promise<void> => {
  const all = await db.select().from(emailTemplatesTable).orderBy(emailTemplatesTable.createdAt);
  res.json(all);
});

// GET /api/templates/:id
router.get("/templates/:id", async (req, res): Promise<void> => {
  const rows = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.id, parseInt(req.params.id, 10)));
  if (!rows[0]) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Template not found" } }); return; }
  res.json(rows[0]);
});

// POST /api/templates
router.post("/templates", async (req, res): Promise<void> => {
  const { name, subject, previewText, body, bodyType, attachments } = req.body ?? {};
  if (!name || !subject || !body) {
    res.status(400).json({ error: { code: "INVALID_INPUT", message: "'name', 'subject', and 'body' are required" } });
    return;
  }
  const [row] = await db.insert(emailTemplatesTable).values({ name, subject, previewText: previewText ?? null, body, bodyType: bodyType ?? "text", attachmentsJson: attachmentsJson(attachments) }).returning();
  res.status(201).json(row);
});

// PATCH /api/templates/:id
router.patch("/templates/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { name, subject, previewText, body, bodyType, attachments } = req.body ?? {};
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (name !== undefined) update.name = name;
  if (subject !== undefined) update.subject = subject;
  if (previewText !== undefined) update.previewText = previewText;
  if (body !== undefined) update.body = body;
  if (bodyType !== undefined) update.bodyType = bodyType;
  if (attachments !== undefined) update.attachmentsJson = attachmentsJson(attachments);
  const [row] = await db.update(emailTemplatesTable).set(update).where(eq(emailTemplatesTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Template not found" } }); return; }
  res.json(row);
});

// DELETE /api/templates/:id
router.delete("/templates/:id", async (req, res): Promise<void> => {
  await db.delete(emailTemplatesTable).where(eq(emailTemplatesTable.id, parseInt(req.params.id, 10)));
  res.status(204).end();
});

export default router;

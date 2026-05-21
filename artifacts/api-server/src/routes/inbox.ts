import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, inboxMessagesTable } from "@workspace/db";
import {
  GetInboxMessageParams,
  UpdateInboxMessageBody,
  UpdateInboxMessageParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/inbox", async (_req, res): Promise<void> => {
  const messages = await db
    .select()
    .from(inboxMessagesTable)
    .where(eq(inboxMessagesTable.isArchived, false))
    .orderBy(inboxMessagesTable.receivedAt);
  res.json(messages);
});

router.get("/inbox/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = GetInboxMessageParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [message] = await db.select().from(inboxMessagesTable).where(eq(inboxMessagesTable.id, params.data.id));
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  res.json(message);
});

router.patch("/inbox/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateInboxMessageParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateInboxMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [message] = await db
    .update(inboxMessagesTable)
    .set(parsed.data)
    .where(eq(inboxMessagesTable.id, params.data.id))
    .returning();
  if (!message) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  res.json(message);
});

export default router;

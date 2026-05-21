import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, emailAccountsTable, type EmailAccount } from "@workspace/db";

const router: IRouter = Router();

function publicAccount(a: EmailAccount) {
  const { smtpPasswordEnc, ...rest } = a;
  return { ...rest, hasSmtpPassword: !!smtpPasswordEnc };
}

// GET /api/v1/mailboxes
router.get("/mailboxes", async (req, res): Promise<void> => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 500);
  const offset = parseInt(String(req.query.offset ?? "0"), 10);
  const all = await db.select().from(emailAccountsTable).orderBy(emailAccountsTable.createdAt);
  res.json({ data: all.slice(offset, offset + limit).map(publicAccount), total: all.length, limit, offset });
});

// GET /api/v1/mailboxes/:id
router.get("/mailboxes/:id", async (req, res): Promise<void> => {
  const rows = await db.select().from(emailAccountsTable).where(eq(emailAccountsTable.id, parseInt(req.params.id, 10)));
  if (!rows[0]) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Mailbox not found" } }); return; }
  res.json(publicAccount(rows[0]));
});

// PATCH /api/v1/mailboxes/:id/limits — set daily sending limit and warmup
router.patch("/mailboxes/:id/limits", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { dailySendLimit, warmupEnabled } = req.body ?? {};
  const update: Record<string, unknown> = {};
  if (dailySendLimit !== undefined) {
    const limit = parseInt(String(dailySendLimit), 10);
    if (isNaN(limit) || limit < 1) { res.status(400).json({ error: { code: "INVALID_INPUT", message: "'dailySendLimit' must be a positive integer" } }); return; }
    update.dailySendLimit = limit;
  }
  if (warmupEnabled !== undefined) update.warmupEnabled = Boolean(warmupEnabled);
  const [row] = await db.update(emailAccountsTable).set(update).where(eq(emailAccountsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Mailbox not found" } }); return; }
  res.json(publicAccount(row));
});

export default router;

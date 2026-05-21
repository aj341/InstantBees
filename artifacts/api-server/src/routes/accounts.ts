import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, emailAccountsTable, type EmailAccount } from "@workspace/db";
import {
  CreateAccountBody,
  UpdateAccountBody,
  UpdateAccountParams,
  DeleteAccountParams,
} from "@workspace/api-zod";
import { encryptSecret } from "../lib/crypto";
import { sendEmail, verifyTransport } from "../lib/mailer";

const router: IRouter = Router();

function publicAccount(a: EmailAccount) {
  const { smtpPasswordEnc, ...rest } = a;
  return { ...rest, hasSmtpPassword: !!smtpPasswordEnc };
}

router.get("/accounts", async (_req, res): Promise<void> => {
  const accounts = await db.select().from(emailAccountsTable).orderBy(emailAccountsTable.createdAt);
  res.json(accounts.map(publicAccount));
});

router.post("/accounts", async (req, res): Promise<void> => {
  const parsed = CreateAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { smtpPassword, ...rest } = parsed.data as typeof parsed.data & { smtpPassword?: string };
  const values: Partial<EmailAccount> & { email: string; provider: EmailAccount["provider"] } = { ...rest } as any;
  if (smtpPassword) {
    values.smtpPasswordEnc = encryptSecret(smtpPassword);
  }
  const [account] = await db.insert(emailAccountsTable).values(values as any).returning();
  if (!account) {
    res.status(500).json({ error: "Failed to create account" });
    return;
  }
  res.status(201).json(publicAccount(account));
});

router.patch("/accounts/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = UpdateAccountParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { smtpPassword, ...rest } = parsed.data as typeof parsed.data & { smtpPassword?: string };
  const updateValues: Record<string, unknown> = { ...rest };
  if (smtpPassword) {
    updateValues.smtpPasswordEnc = encryptSecret(smtpPassword);
  }
  const [account] = await db.update(emailAccountsTable).set(updateValues).where(eq(emailAccountsTable.id, params.data.id)).returning();
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.json(publicAccount(account));
});

router.delete("/accounts/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = DeleteAccountParams.safeParse({ id: parseInt(raw, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [account] = await db.delete(emailAccountsTable).where(eq(emailAccountsTable.id, params.data.id)).returning();
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/accounts/:id/test", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ ok: false, error: "Invalid id" });
    return;
  }
  const [account] = await db.select().from(emailAccountsTable).where(eq(emailAccountsTable.id, id));
  if (!account) {
    res.status(404).json({ ok: false, error: "Account not found" });
    return;
  }
  try {
    await verifyTransport(account);
    await sendEmail(account, {
      to: account.email,
      toName: account.name,
      subject: "Outreach.io connection test",
      body: "This is a test email from Outreach.io to verify your SMTP connection is working.",
      bodyType: "text",
    });
    await db
      .update(emailAccountsTable)
      .set({ status: "connected", lastError: null })
      .where(eq(emailAccountsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(emailAccountsTable)
      .set({ status: "error", lastError: message })
      .where(eq(emailAccountsTable.id, id));
    res.json({ ok: false, error: message });
  }
});

export default router;

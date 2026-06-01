import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, emailAccountsTable, type EmailAccount } from "@workspace/db";
import {
  CreateAccountBody,
  UpdateAccountBody,
  UpdateAccountParams,
  DeleteAccountParams,
} from "@workspace/api-zod";
import { encryptSecret } from "../lib/crypto";
import { sendEmail, verifyTransport } from "../lib/mailer";
import {
  hasPendingJobsForAccount,
  rebalancePendingJobsForActiveCampaigns,
  reassignPendingJobsForAccount,
} from "../lib/account-rotation";
import { importEmailAccounts } from "../lib/account-import";

const router: IRouter = Router();

function publicAccount(a: EmailAccount) {
  const { smtpPasswordEnc, ...rest } = a;
  return { ...rest, hasSmtpPassword: !!smtpPasswordEnc };
}

function normalizeAccountStatus(input: Partial<EmailAccount>): Partial<EmailAccount> {
  if (input.warmupEnabled === true && !input.status) return { ...input, status: "warming" };
  if (input.warmupEnabled === false && input.status === "warming") return { ...input, status: "connected" };
  return input;
}

function cleanAccountInput<T extends Partial<EmailAccount>>(input: T): T {
  return {
    ...input,
    email: input.email?.toLowerCase().trim(),
    name: input.name?.trim() || null,
    smtpHost: input.smtpHost?.trim() || null,
    smtpUsername: input.smtpUsername?.trim() || null,
    imapHost: input.imapHost?.trim() || null,
  };
}

router.get("/accounts", async (_req, res): Promise<void> => {
  const today = new Date().toISOString().slice(0, 10);
  await db
    .update(emailAccountsTable)
    .set({ sentToday: 0, sentTodayDate: today })
    .where(sql`${emailAccountsTable.sentTodayDate} is null or ${emailAccountsTable.sentTodayDate} <> ${today}`);
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
  const email = rest.email.toLowerCase().trim();
  const [existing] = await db.select({ id: emailAccountsTable.id }).from(emailAccountsTable).where(eq(emailAccountsTable.email, email)).limit(1);
  if (existing) {
    res.status(409).json({ error: `Email account already exists for ${email}` });
    return;
  }
  const values: Partial<EmailAccount> & { email: string; provider: EmailAccount["provider"] } = normalizeAccountStatus(cleanAccountInput({ ...rest, email } as any)) as any;
  if (smtpPassword) {
    values.smtpPasswordEnc = encryptSecret(smtpPassword);
  }
  const [account] = await db.insert(emailAccountsTable).values(values as any).returning();
  if (!account) {
    res.status(500).json({ error: "Failed to create account" });
    return;
  }
  if ((account.status === "connected" || account.status === "warming") && account.smtpPasswordEnc) {
    await rebalancePendingJobsForActiveCampaigns();
  }
  res.status(201).json(publicAccount(account));
});

router.post("/accounts/bulk", async (req, res): Promise<void> => {
  try {
    const result = await importEmailAccounts(req.body ?? {});
    if (result.total === 0) {
      res.status(400).json({ error: "Upload a CSV with account rows or send an accounts array." });
      return;
    }
    res.status(result.imported > 0 ? 201 : 200).json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Import failed" });
  }
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
  const [existing] = await db.select().from(emailAccountsTable).where(eq(emailAccountsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const normalized = normalizeAccountStatus(cleanAccountInput({
    ...rest,
    status: rest.warmupEnabled === false && existing.status === "warming" && !rest.status ? "connected" : rest.status,
  } as Partial<EmailAccount>));
  const updateValues: Record<string, unknown> = { ...normalized };
  if (smtpPassword) {
    updateValues.smtpPasswordEnc = encryptSecret(smtpPassword);
  }
  const [account] = await db.update(emailAccountsTable).set(updateValues).where(eq(emailAccountsTable.id, params.data.id)).returning();
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  if ((account.status === "connected" || account.status === "warming") && account.smtpPasswordEnc) {
    await rebalancePendingJobsForActiveCampaigns();
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
  if (await hasPendingJobsForAccount(params.data.id)) {
    const reassigned = await reassignPendingJobsForAccount(params.data.id);
    if (reassigned === 0) {
      res.status(409).json({ error: "This account has pending campaign sends. Add another sendable account before deleting it." });
      return;
    }
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
      subject: "Instant Bees connection test",
      body: "This is a test email from Instant Bees to verify your SMTP connection is working.",
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

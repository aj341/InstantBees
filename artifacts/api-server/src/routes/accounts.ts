import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, emailAccountsTable } from "@workspace/db";
import {
  CreateAccountBody,
  UpdateAccountBody,
  UpdateAccountParams,
  DeleteAccountParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/accounts", async (_req, res): Promise<void> => {
  const accounts = await db.select().from(emailAccountsTable).orderBy(emailAccountsTable.createdAt);
  res.json(accounts);
});

router.post("/accounts", async (req, res): Promise<void> => {
  const parsed = CreateAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [account] = await db.insert(emailAccountsTable).values(parsed.data).returning();
  res.status(201).json(account);
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
  const [account] = await db.update(emailAccountsTable).set(parsed.data).where(eq(emailAccountsTable.id, params.data.id)).returning();
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.json(account);
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

export default router;

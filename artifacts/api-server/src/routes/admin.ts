import { Router, type IRouter } from "express";
import {
  db,
  campaignsTable,
  campaignLeadsTable,
  sequenceStepsTable,
  leadsTable,
  emailSendJobsTable,
  inboxMessagesTable,
  unsubscribesTable,
  dailyStatsTable,
  leadListsTable,
  listLeadsTable,
} from "@workspace/db";

const router: IRouter = Router();

/**
 * Wipe all operational data so the dashboard reflects a clean slate.
 * Email accounts and templates are preserved (those are configuration, not "simulated data").
 * Optional body: `{ includeAccounts?: boolean, includeTemplates?: boolean }`.
 */
router.post("/admin/reset", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as { includeAccounts?: boolean; includeTemplates?: boolean };

  // Order matters when there are dependent rows — clear child tables first.
  await db.delete(emailSendJobsTable);
  await db.delete(inboxMessagesTable);
  await db.delete(unsubscribesTable);
  await db.delete(sequenceStepsTable);
  await db.delete(campaignLeadsTable);
  await db.delete(listLeadsTable);
  await db.delete(dailyStatsTable);
  await db.delete(leadListsTable);
  await db.delete(campaignsTable);
  await db.delete(leadsTable);

  // Optional — only blow away accounts/templates if the caller explicitly asks.
  if (body.includeAccounts) {
    const { emailAccountsTable } = await import("@workspace/db");
    await db.delete(emailAccountsTable);
  }
  if (body.includeTemplates) {
    const { emailTemplatesTable } = await import("@workspace/db");
    await db.delete(emailTemplatesTable);
  }

  res.json({ ok: true });
});

export default router;

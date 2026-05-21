import { Router, type IRouter } from "express";
import {
  db,
  campaignsTable,
  campaignLeadsTable,
  sequenceStepsTable,
  leadsTable,
  emailSendJobsTable,
  emailAccountsTable,
  emailTemplatesTable,
  inboxMessagesTable,
  unsubscribesTable,
  dailyStatsTable,
  leadListsTable,
  listLeadsTable,
} from "@workspace/db";
import { ResetAllDataBody } from "@workspace/api-zod";

const router: IRouter = Router();

/**
 * Wipe all operational data so the dashboard reflects a clean slate.
 * Email accounts and templates are preserved unless explicitly requested.
 * Body requires `confirm: "DELETE_ALL_DATA"` to prevent accidental wipes.
 */
router.post("/admin/reset", async (req, res): Promise<void> => {
  const parsed = ResetAllDataBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { includeAccounts, includeTemplates } = parsed.data;

  // One transaction so concurrent inserts can't leave orphan rows mid-wipe.
  await db.transaction(async (tx) => {
    // Order matters when there are dependent rows — clear child tables first.
    await tx.delete(emailSendJobsTable);
    await tx.delete(inboxMessagesTable);
    await tx.delete(unsubscribesTable);
    await tx.delete(sequenceStepsTable);
    await tx.delete(campaignLeadsTable);
    await tx.delete(listLeadsTable);
    await tx.delete(dailyStatsTable);
    await tx.delete(leadListsTable);
    await tx.delete(campaignsTable);
    await tx.delete(leadsTable);

    if (includeAccounts === true) await tx.delete(emailAccountsTable);
    if (includeTemplates === true) await tx.delete(emailTemplatesTable);
  });

  res.json({ ok: true });
});

export default router;

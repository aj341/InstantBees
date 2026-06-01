import { Router, type IRouter } from "express";
import {
  db,
  campaignsTable,
  campaignLeadsTable,
  sequenceStepsTable,
  sequenceStepVariantsTable,
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
  db.transaction((tx) => {
    // Order matters when there are dependent rows — clear child tables first.
    tx.delete(emailSendJobsTable).run();
    tx.delete(inboxMessagesTable).run();
    tx.delete(unsubscribesTable).run();
    tx.delete(sequenceStepVariantsTable).run();
    tx.delete(sequenceStepsTable).run();
    tx.delete(campaignLeadsTable).run();
    tx.delete(listLeadsTable).run();
    tx.delete(dailyStatsTable).run();
    tx.delete(leadListsTable).run();
    tx.delete(campaignsTable).run();
    tx.delete(leadsTable).run();

    if (includeAccounts === true) tx.delete(emailAccountsTable).run();
    if (includeTemplates === true) tx.delete(emailTemplatesTable).run();
  });

  res.json({ ok: true });
});

export default router;

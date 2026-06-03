import { Router, type IRouter } from "express";
import {
  campaignsTable,
  clickEventsTable,
  db,
  emailAccountsTable,
  emailSendJobsTable,
  inboxMessagesTable,
  leadsTable,
  sequenceStepsTable,
  unsubscribesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildDeliverabilityOverview, domainFromEmail, domainHealth } from "../lib/deliverability";

const router: IRouter = Router();

router.get("/deliverability/overview", async (_req, res): Promise<void> => {
  const [campaigns, leads, accounts, steps, jobs, clicks, replies, unsubscribes] = await Promise.all([
    db.select().from(campaignsTable),
    db.select().from(leadsTable),
    db.select().from(emailAccountsTable),
    db.select().from(sequenceStepsTable),
    db.select().from(emailSendJobsTable),
    db.select().from(clickEventsTable),
    db.select().from(inboxMessagesTable),
    db.select().from(unsubscribesTable),
  ]);

  const domains = await domainHealth(accounts.map((account) => domainFromEmail(account.email)));
  res.json(buildDeliverabilityOverview({ campaigns, leads, accounts, steps, jobs, clicks, replies, unsubscribes, domains }));
});

router.post("/deliverability/content-risks/:stepId/review", async (req, res): Promise<void> => {
  const stepId = Number.parseInt(String(req.params.stepId), 10);
  if (!Number.isFinite(stepId) || stepId < 1) {
    res.status(400).json({ error: "Invalid step id" });
    return;
  }
  const [step] = await db
    .update(sequenceStepsTable)
    .set({ contentReviewedAt: new Date() })
    .where(eq(sequenceStepsTable.id, stepId))
    .returning();
  if (!step) {
    res.status(404).json({ error: "Step not found" });
    return;
  }
  res.json(step);
});

export default router;

import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, emailSendJobsTable, campaignsTable, leadsTable, unsubscribesTable } from "@workspace/db";

const router: IRouter = Router();

const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

router.get("/track/open/:token.gif", async (req, res): Promise<void> => {
  const token = req.params.token;
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  res.end(PIXEL);

  try {
    const [job] = await db.select().from(emailSendJobsTable).where(eq(emailSendJobsTable.trackingToken, token));
    if (!job) return;

    const isFirstOpen = !job.firstOpenedAt;
    await db
      .update(emailSendJobsTable)
      .set({
        openCount: sql`${emailSendJobsTable.openCount} + 1`,
        firstOpenedAt: isFirstOpen ? new Date() : job.firstOpenedAt,
      })
      .where(eq(emailSendJobsTable.id, job.id));

    if (isFirstOpen) {
      await db
        .update(campaignsTable)
        .set({ openCount: sql`${campaignsTable.openCount} + 1` })
        .where(eq(campaignsTable.id, job.campaignId));
    }
  } catch {
    // Swallow — pixel must always succeed
  }
});

router.get("/unsubscribe/:token", async (req, res): Promise<void> => {
  const token = req.params.token;
  const [unsub] = await db.select().from(unsubscribesTable).where(eq(unsubscribesTable.token, token));

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!unsub) {
    res.status(404).send(renderUnsubPage("Invalid link", "We couldn't find that unsubscribe link. It may have already been used."));
    return;
  }
  if (unsub.unsubscribedAt) {
    res.send(renderUnsubPage("Already unsubscribed", "You've already opted out. You won't receive further emails."));
    return;
  }
  res.send(renderUnsubPage(
    "Confirm unsubscribe",
    "Click the button below to stop receiving emails from us.",
    `<form method="post" action="/api/unsubscribe/${token}" style="margin-top:24px;"><button type="submit" style="background:#222;color:#fff;border:0;padding:12px 24px;border-radius:6px;font-size:14px;cursor:pointer;">Unsubscribe</button></form>`,
  ));
});

router.post("/unsubscribe/:token", async (req, res): Promise<void> => {
  const token = req.params.token;
  const [unsub] = await db.select().from(unsubscribesTable).where(eq(unsubscribesTable.token, token));
  if (!unsub) {
    res.status(404).type("html").send(renderUnsubPage("Invalid link", "We couldn't find that unsubscribe link."));
    return;
  }
  if (!unsub.unsubscribedAt) {
    await db.update(unsubscribesTable).set({ unsubscribedAt: new Date() }).where(eq(unsubscribesTable.id, unsub.id));
    await db.update(leadsTable).set({ status: "unsubscribed" }).where(eq(leadsTable.id, unsub.leadId));
  }
  res.type("html").send(renderUnsubPage("You're unsubscribed", "Thanks. You won't hear from us again."));
});

function renderUnsubPage(title: string, body: string, extra: string = ""): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fafafa;color:#222;}
.card{max-width:480px;margin:80px auto;padding:36px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);}
h1{margin:0 0 12px;font-size:22px;}
p{line-height:1.55;color:#555;margin:0;}
</style></head>
<body><div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>${extra}</div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export default router;

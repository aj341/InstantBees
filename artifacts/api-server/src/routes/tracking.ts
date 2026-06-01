import { Router, type IRouter } from "express";
import { eq, and, sql, isNull } from "drizzle-orm";
import { db, emailSendJobsTable, campaignsTable, leadsTable, unsubscribesTable, clickEventsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { verifyClickSignature } from "../lib/mailer";

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

    // Atomic first-open: only the row update that succeeds (firstOpenedAt was NULL) increments the campaign.
    const firstOpenSet = await db
      .update(emailSendJobsTable)
      .set({ openCount: sql`${emailSendJobsTable.openCount} + 1`, firstOpenedAt: new Date() })
      .where(and(eq(emailSendJobsTable.id, job.id), isNull(emailSendJobsTable.firstOpenedAt)))
      .returning({ id: emailSendJobsTable.id });

    if (firstOpenSet.length > 0) {
      await db
        .update(campaignsTable)
        .set({ openCount: sql`${campaignsTable.openCount} + 1` })
        .where(eq(campaignsTable.id, job.campaignId));
    } else {
      // Subsequent open — just bump the count.
      await db
        .update(emailSendJobsTable)
        .set({ openCount: sql`${emailSendJobsTable.openCount} + 1` })
        .where(eq(emailSendJobsTable.id, job.id));
    }
  } catch (err) {
    logger.error({ err, token }, "Failed to record email open");
    // Swallow — pixel must always succeed
  }
});

router.get("/track/click/:token", async (req, res): Promise<void> => {
  const token = req.params.token;
  const rawTarget = req.query["u"];
  const rawSig = req.query["s"];
  const target = typeof rawTarget === "string" ? rawTarget : "";
  const sig = typeof rawSig === "string" ? rawSig : "";

  // Validate protocol — must be http(s) so we can never redirect to javascript: or data:.
  let parsedTarget: URL | null = null;
  try {
    const u = new URL(target);
    if (u.protocol === "http:" || u.protocol === "https:") parsedTarget = u;
  } catch {
    parsedTarget = null;
  }
  if (!parsedTarget) {
    res.status(400).type("text/plain").send("Invalid link");
    return;
  }

  // Verify HMAC signature binding the destination to this specific token, so the destination
  // can't be tampered with and this endpoint can't be used as a generic open redirect.
  if (!sig || !verifyClickSignature(token, target, sig)) {
    res.status(400).type("text/plain").send("Invalid signature");
    return;
  }

  // Verify the token actually exists (i.e. corresponds to a real outbound email) before redirecting.
  const [job] = await db.select().from(emailSendJobsTable).where(eq(emailSendJobsTable.trackingToken, token));
  if (!job) {
    res.status(404).type("text/plain").send("Unknown tracking token");
    return;
  }

  res.redirect(302, parsedTarget.toString());

  try {
    // Log the per-link click so we can show a URL-level breakdown on the campaign page.
    await db.insert(clickEventsTable).values({
      sendJobId: job.id,
      campaignId: job.campaignId,
      leadId: job.leadId,
      url: parsedTarget.toString(),
    });

    // Atomic first-click: row update only succeeds if firstClickedAt was NULL.
    const clickedAt = new Date();
    const firstClickSet = await db
      .update(emailSendJobsTable)
      .set({
        clickCount: sql`${emailSendJobsTable.clickCount} + 1`,
        firstClickedAt: clickedAt,
        firstOpenedAt: job.firstOpenedAt ?? clickedAt,
      })
      .where(and(eq(emailSendJobsTable.id, job.id), isNull(emailSendJobsTable.firstClickedAt)))
      .returning({ id: emailSendJobsTable.id });

    if (firstClickSet.length > 0) {
      // Campaign clickCount tracks total raw clicks. Unique clicked leads are
      // derived from click_events for reporting.
      await db.update(campaignsTable).set({ clickCount: sql`${campaignsTable.clickCount} + 1` }).where(eq(campaignsTable.id, job.campaignId));
    } else {
      await db
        .update(emailSendJobsTable)
        .set({ clickCount: sql`${emailSendJobsTable.clickCount} + 1` })
        .where(eq(emailSendJobsTable.id, job.id));
      await db.update(campaignsTable).set({ clickCount: sql`${campaignsTable.clickCount} + 1` }).where(eq(campaignsTable.id, job.campaignId));
    }
  } catch (err) {
    logger.error({ err, token, target: parsedTarget.toString() }, "Failed to record link click");
    // Swallow — redirect already sent
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

import { Router, type IRouter } from "express";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  db,
  databasePath,
  sqlite,
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

function unlinkIfExists(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

function validateSqliteFile(filePath: string): void {
  const candidate = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const result = candidate.prepare("PRAGMA integrity_check").get() as { integrity_check: string } | undefined;
    if (result?.integrity_check !== "ok") {
      throw new Error(`SQLite integrity check failed: ${result?.integrity_check ?? "unknown"}`);
    }
  } finally {
    candidate.close();
  }
}

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

router.post("/admin/database/restore", async (req, res): Promise<void> => {
  const body = req.body as { confirm?: string; databaseBase64?: string } | undefined;
  if (body?.confirm !== "RESTORE_SQLITE_DATABASE") {
    res.status(400).json({ error: "Missing restore confirmation" });
    return;
  }
  if (!body.databaseBase64 || typeof body.databaseBase64 !== "string") {
    res.status(400).json({ error: "databaseBase64 is required" });
    return;
  }

  const raw = Buffer.from(body.databaseBase64, "base64");
  if (raw.subarray(0, 16).toString("utf8") !== "SQLite format 3\0") {
    res.status(400).json({ error: "Uploaded file is not a SQLite database" });
    return;
  }

  const dir = path.dirname(databasePath);
  const restoreId = Date.now();
  const tempPath = path.join(dir, `sales-automation.restore-${restoreId}.sqlite`);
  const backupPath = `${databasePath}.backup-${restoreId}`;
  fs.writeFileSync(tempPath, raw, { mode: 0o600 });

  try {
    validateSqliteFile(tempPath);
  } catch (err) {
    unlinkIfExists(tempPath);
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid SQLite database" });
    return;
  }

  res.json({ ok: true, restarting: true });

  setTimeout(() => {
    try {
      sqlite.close();
      if (fs.existsSync(databasePath)) fs.copyFileSync(databasePath, backupPath);
      unlinkIfExists(`${databasePath}-wal`);
      unlinkIfExists(`${databasePath}-shm`);
      fs.renameSync(tempPath, databasePath);
    } finally {
      process.exit(0);
    }
  }, 100);
});

export default router;

import app from "./app";
import { logger } from "./lib/logger";
import { startInboxWorker } from "./lib/inbox-worker";
import { startSendWorker } from "./lib/worker";
import { syncC7JuneAttachments } from "./lib/c7-attachment-sync";

const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  void (async () => {
    // Database startup migrations are loaded before workers start.
    // Deploy marker: queued A/B variant analytics split.
    await syncC7JuneAttachments();
    logger.info({ port }, "Server listening");
    if (process.env["DISABLE_SEND_WORKER"] === "1") {
      logger.warn("Email send worker disabled by DISABLE_SEND_WORKER=1");
    } else {
      startSendWorker();
    }

    if (process.env["DISABLE_INBOX_WORKER"] === "1") {
      logger.warn("Inbox worker disabled by DISABLE_INBOX_WORKER=1");
    } else {
      startInboxWorker();
    }
  })().catch((startupError) => {
    logger.error({ err: startupError }, "Startup sync failed");
    process.exit(1);
  });
});

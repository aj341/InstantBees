import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import fs from "node:fs";
import path from "node:path";
import router from "./routes";
import { logger } from "./lib/logger";
import { buildSessionMiddleware, requireAuth } from "./lib/auth";

const app: Express = express();

// Trust the Replit reverse proxy so req.secure reflects the original HTTPS
// connection. Without this, secure session cookies are never issued in
// production and every authenticated request returns 401 after login.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
// Default JSON body limit applies to most routes. The bulk lead import path needs more headroom
// for large CSVs / lead arrays, but we scope the bump to that route only.
app.use("/api/admin/database/restore", express.json({ limit: "25mb" }));
app.use("/api/v1/campaign-packages", express.json({ limit: "25mb" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/api/leads/bulk", express.json({ limit: "10mb" }));
app.use("/api/leads/bulk", express.text({ type: ["text/csv", "application/csv"], limit: "10mb" }));

app.use(buildSessionMiddleware());
app.use("/api", requireAuth);
app.use("/api", router);

function resolveStaticDir(): string | null {
  const candidates = [
    process.env["STATIC_DIR"],
    path.resolve(process.cwd(), "artifacts/instantly/dist/public"),
    path.resolve(process.cwd(), "../instantly/dist/public"),
    path.resolve(process.cwd(), "dist/public"),
  ].filter((value): value is string => Boolean(value));

  return candidates.find((candidate) => fs.existsSync(path.join(candidate, "index.html"))) ?? null;
}

const staticDir = resolveStaticDir();
if (staticDir) {
  logger.info({ staticDir }, "Serving frontend assets");
  app.use(express.static(staticDir));
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
} else {
  logger.warn("No built frontend assets found; API-only mode enabled");
}

export default app;

import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { logger } from "./logger";

declare module "express-session" {
  interface SessionData {
    user?: { username: string };
  }
}

const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "admin";

function hash(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

export function verifyCredentials(username: string, password: string): boolean {
  const expectedUser = process.env["ADMIN_USERNAME"] || DEFAULT_USERNAME;
  const expectedPass = process.env["ADMIN_PASSWORD"] || DEFAULT_PASSWORD;
  const userOk = (() => {
    const a = hash(username);
    const b = hash(expectedUser);
    return a.length === b.length && timingSafeEqual(a, b);
  })();
  const passOk = (() => {
    const a = hash(password);
    const b = hash(expectedPass);
    return a.length === b.length && timingSafeEqual(a, b);
  })();
  return userOk && passOk;
}

export function isUsingDefaultCredentials(): boolean {
  return !process.env["ADMIN_USERNAME"] || !process.env["ADMIN_PASSWORD"];
}

export function buildSessionMiddleware(): RequestHandler {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) {
    throw new Error("SESSION_SECRET is required for session middleware");
  }
  const dbUrl = process.env["DATABASE_URL"];
  if (!dbUrl) {
    throw new Error("DATABASE_URL is required for session middleware");
  }
  const PgStore = connectPgSimple(session);
  const store = new PgStore({
    conString: dbUrl,
    tableName: "user_sessions",
    // Table is declared in @workspace/db schema and created via drizzle-kit
    // push, so we disable connect-pg-simple's auto-create (it reads a
    // table.sql file that esbuild doesn't include in the production bundle).
    createTableIfMissing: false,
  });
  if (isUsingDefaultCredentials()) {
    logger.warn(
      "ADMIN_USERNAME / ADMIN_PASSWORD are not set — falling back to admin/admin. Set these secrets before deploying.",
    );
  }
  return session({
    name: "outreach.sid",
    secret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env["NODE_ENV"] === "production",
      maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
    },
  });
}

/**
 * Routes that must remain reachable without a logged-in session:
 *  - tracking pixels & click redirects (called from recipients' inboxes)
 *  - unsubscribe links (recipients clicking them aren't users)
 *  - the auth endpoints themselves
 *  - health checks
 *  - v1 API key endpoints (already protected by their own API key middleware)
 */
// Paths are evaluated relative to the /api mount point.
// MCP and v1 endpoints have their own API-key auth (see middleware/api-auth.ts) and need
// to stay reachable for Claude / external integrations even when no user session exists.
const PUBLIC_PATH_PREFIXES = [
  "/auth/",
  "/track/",
  "/unsubscribe/",
  "/healthz",
  "/v1/",
  "/mcp/",
];

export const requireAuth: RequestHandler = (req, res, next) => {
  const p = req.path;
  if (PUBLIC_PATH_PREFIXES.some((prefix) => p === prefix.replace(/\/$/, "") || p.startsWith(prefix))) {
    next();
    return;
  }
  if (req.session?.user) {
    next();
    return;
  }
  res.status(401).json({ error: "Not authenticated" });
};

import session from "express-session";
import { createHash, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { sqlite } from "@workspace/db";
import { logger } from "./logger";

declare module "express-session" {
  interface SessionData {
    user?: { username: string };
  }
}

const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "admin";

class SqliteSessionStore extends session.Store {
  get(sid: string, callback: (err: unknown, session?: session.SessionData | null) => void): void {
    try {
      const row = sqlite
        .prepare("SELECT sess, expire FROM user_sessions WHERE sid = ?")
        .get(sid) as { sess: string; expire: number } | undefined;

      if (!row) {
        callback(null, null);
        return;
      }

      if (row.expire <= Date.now()) {
        this.destroy(sid, () => callback(null, null));
        return;
      }

      callback(null, JSON.parse(row.sess) as session.SessionData);
    } catch (err) {
      callback(err);
    }
  }

  set(sid: string, sess: session.SessionData, callback?: (err?: unknown) => void): void {
    try {
      const expire = getSessionExpiry(sess);
      sqlite
        .prepare(
          `INSERT INTO user_sessions (sid, sess, expire)
           VALUES (?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire`,
        )
        .run(sid, JSON.stringify(sess), expire);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    try {
      sqlite.prepare("DELETE FROM user_sessions WHERE sid = ?").run(sid);
      callback?.();
    } catch (err) {
      callback?.(err);
    }
  }

  touch(sid: string, sess: session.SessionData, callback?: () => void): void {
    const expire = getSessionExpiry(sess);
    sqlite.prepare("UPDATE user_sessions SET expire = ? WHERE sid = ?").run(expire, sid);
    callback?.();
  }
}

function getSessionExpiry(sess: session.SessionData): number {
  const expires = sess.cookie.expires;
  if (expires instanceof Date) return expires.getTime();
  if (typeof expires === "string") return new Date(expires).getTime();
  return Date.now() + (sess.cookie.maxAge ?? 1000 * 60 * 60 * 24 * 14);
}

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
  const store = new SqliteSessionStore();
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

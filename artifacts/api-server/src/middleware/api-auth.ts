import { type Request, type Response, type NextFunction } from "express";

const API_KEY = process.env.CLAUDE_API_KEY;

/** Header-only auth — used by all /api/v1/ routes. */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers["authorization"];
  const key = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!key) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing Authorization: Bearer <key> header" } });
    return;
  }
  if (!API_KEY || key !== API_KEY) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid API key" } });
    return;
  }
  next();
}

/** MCP-only auth — accepts Bearer header OR ?key= query param. */
export function mcpAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers["authorization"];
  const headerKey = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const queryKey = typeof req.query.key === "string" ? req.query.key : null;
  const key = headerKey ?? queryKey;
  if (!key) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing API key. Pass Authorization: Bearer <key> header or ?key=<token> query param." } });
    return;
  }
  if (!API_KEY || key !== API_KEY) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid API key" } });
    return;
  }
  next();
}

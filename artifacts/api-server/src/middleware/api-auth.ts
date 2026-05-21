import { type Request, type Response, type NextFunction } from "express";

const API_KEY = process.env.CLAUDE_API_KEY;

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  // Accept key via Authorization header OR ?token= query param (for clients that can't set headers)
  const auth = req.headers["authorization"];
  const headerKey = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const queryKey = typeof req.query.token === "string" ? req.query.token : null;
  const key = headerKey ?? queryKey;

  if (!key) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing API key. Pass Authorization: Bearer <key> header or ?token=<key> query param." } });
    return;
  }
  if (!API_KEY || key !== API_KEY) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid API key" } });
    return;
  }
  next();
}

import { type Request, type Response, type NextFunction } from "express";

const API_KEY = process.env.CLAUDE_API_KEY;

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const auth = req.headers["authorization"];
  if (!auth || !auth.startsWith("Bearer ")) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing Authorization: Bearer <key> header" } });
    return;
  }
  const key = auth.slice(7).trim();
  if (!API_KEY || key !== API_KEY) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid API key" } });
    return;
  }
  next();
}

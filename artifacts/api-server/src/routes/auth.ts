import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { verifyCredentials, isUsingDefaultCredentials } from "../lib/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const LoginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

router.post("/auth/login", (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Username and password are required" });
    return;
  }
  const { username, password } = parsed.data;
  if (!verifyCredentials(username, password)) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }
  // Regenerate the session ID on login to prevent session fixation: any pre-existing
  // session cookie the client arrives with is discarded and a new sid is issued.
  req.session.regenerate((regenErr) => {
    if (regenErr) {
      logger.error({ err: regenErr }, "Failed to regenerate session on login");
      res.status(500).json({ error: "Failed to create session" });
      return;
    }
    req.session.user = { username };
    req.session.save((saveErr) => {
      if (saveErr) {
        logger.error({ err: saveErr }, "Failed to save session");
        res.status(500).json({ error: "Failed to create session" });
        return;
      }
      res.json({ username, usingDefaultCredentials: isUsingDefaultCredentials() });
    });
  });
});

router.post("/auth/logout", (req, res) => {
  if (!req.session) {
    res.json({ ok: true });
    return;
  }
  req.session.destroy(() => {
    res.clearCookie("outreach.sid");
    res.json({ ok: true });
  });
});

router.get("/auth/me", (req, res) => {
  if (!req.session?.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({
    username: req.session.user.username,
    usingDefaultCredentials: isUsingDefaultCredentials(),
  });
});

export default router;

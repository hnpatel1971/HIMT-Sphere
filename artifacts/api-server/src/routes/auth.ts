import { Router } from "express";
import { timingSafeEqual } from "crypto";

// Augment express-session so TypeScript knows about our custom field.
declare module "express-session" {
  interface SessionData {
    isAdmin: boolean;
  }
}

const router = Router();

/** GET /api/auth/status — returns whether the current session has admin rights. */
router.get("/auth/status", (req, res) => {
  res.json({ isAdmin: req.session.isAdmin === true });
});

/**
 * POST /api/auth/login
 *
 * Validates the submitted username and password against ADMIN_USERNAME and
 * ADMIN_PASSWORD environment variables.  On success, marks the session as
 * admin.  The credential check is timing-safe.
 *
 * If neither env var is configured the endpoint returns 503 so the server
 * fails closed rather than falling back to hard-coded defaults.
 */
router.post("/auth/login", (req, res) => {
  const { username = "", password = "" } = req.body as { username?: string; password?: string };

  const adminUsername = process.env.ADMIN_USERNAME ?? "";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "";

  if (!adminUsername || !adminPassword) {
    res.status(503).json({
      error: "Admin credentials not configured — set ADMIN_USERNAME and ADMIN_PASSWORD on the server",
    });
    return;
  }

  // Use timing-safe comparison to prevent username/password oracle attacks.
  let valid = false;
  try {
    const uOk =
      username.length === adminUsername.length &&
      timingSafeEqual(Buffer.from(username, "utf8"), Buffer.from(adminUsername, "utf8"));
    const pOk =
      password.length === adminPassword.length &&
      timingSafeEqual(Buffer.from(password, "utf8"), Buffer.from(adminPassword, "utf8"));
    valid = uOk && pOk;
  } catch { valid = false; }

  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  // Regenerate the session ID on privilege elevation (session-fixation defense).
  req.session.regenerate(regenErr => {
    if (regenErr) { res.status(500).json({ error: "Session error" }); return; }
    req.session.isAdmin = true;
    req.session.save(saveErr => {
      if (saveErr) { res.status(500).json({ error: "Failed to save session" }); return; }
      res.json({ ok: true });
    });
  });
});

/** POST /api/auth/logout — destroys the admin session. */
router.post("/auth/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) { res.status(500).json({ error: "Logout failed" }); return; }
    res.json({ ok: true });
  });
});

export default router;

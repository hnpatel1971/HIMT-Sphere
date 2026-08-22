import { Router } from "express";
import { timingSafeEqual } from "crypto";
import { clerkClient, getAuth } from "@clerk/express";
import { and, eq, ilike } from "drizzle-orm";
import { db, learnerIdentities, users } from "@workspace/db";

// Augment express-session so TypeScript knows about our custom field.
declare module "express-session" {
  interface SessionData {
    isAdmin: boolean;
  }
}

const router = Router();

async function clerkDirectoryAdmin(req: import("express").Request): Promise<boolean> {
  const clerkUserId = getAuth(req).userId;
  if (!clerkUserId) return false;

  const [identity] = await db.select().from(learnerIdentities)
    .where(eq(learnerIdentities.clerkUserId, clerkUserId));
  let directoryUser = identity
    ? (await db.select().from(users).where(eq(users.id, identity.userId)))[0]
    : undefined;

  if (!directoryUser) {
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    const email = clerkUser.primaryEmailAddress?.emailAddress?.trim().toLowerCase();
    if (!email) return false;
    directoryUser = (await db.select().from(users).where(ilike(users.email, email)))[0];
    if (!directoryUser) return false;
    const invitationBound = typeof clerkUser.publicMetadata === "object"
      && clerkUser.publicMetadata !== null
      && (clerkUser.publicMetadata as Record<string, unknown>).lmsUserId === directoryUser.id;
    if (directoryUser.status !== "Active") {
      if (directoryUser.status !== "Invited" || !invitationBound) return false;
      [directoryUser] = await db.update(users)
        .set({ status: "Active", lastActivity: "Just now" })
        .where(and(eq(users.id, directoryUser.id), eq(users.status, "Invited")))
        .returning();
    }
    await db.insert(learnerIdentities).values({
      clerkUserId,
      userId: directoryUser.id,
      email,
      updatedAt: new Date(),
    }).onConflictDoNothing();
  }

  return directoryUser.role === "admin" && directoryUser.status === "Active";
}

/** GET /api/auth/status — directory Admin role or deliberate break-glass session. */
router.get("/auth/status", async (req, res) => {
  if (req.session.isAdmin === true) { res.json({ isAdmin: true }); return; }
  try {
    res.json({ isAdmin: await clerkDirectoryAdmin(req) });
  } catch {
    res.json({ isAdmin: false });
  }
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

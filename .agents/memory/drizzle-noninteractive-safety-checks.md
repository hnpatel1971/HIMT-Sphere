---
name: Drizzle noninteractive safety checks
description: Guard development schema pushes against unsafe Drizzle prompts that do not reliably return a failing exit status.
---

When running Drizzle schema pushes in a noninteractive process, do not trust the exit status alone. Require the expected safe completion output, reject destructive or approval-prompt output, and confirm protected session and application rows still exist after the push.

**Why:** Drizzle can encounter an unmanaged table, emit a TTY-only approval error, and still exit with status zero. That would otherwise allow a post-merge update to continue without proving its schema diff was safe.

**How to apply:** Keep the schema-push regression fixture on an isolated PostgreSQL instance. It must seed externally owned session data and representative application data before the first push, require the second push to be a no-op, and never use automatic data-loss approval.
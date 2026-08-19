import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const packageRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

async function getAvailablePort(): Promise<number> {
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a TCP port");
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForRoster(baseUrl: string) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/users`);
      if (response.ok) {
        const users = await response.json() as Array<{ id: string; group: string }>;
        const user = users.find((row) => row.id === "user-001");
        if (user) return user;
      }
    } catch {
      // The test server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test roster did not become available");
}

test("only an authenticated admin can update a user's group", async (t) => {
  const port = await getAvailablePort();
  const serverProcess = spawn(process.execPath, ["--enable-source-maps", "dist/index.mjs"], {
    cwd: packageRoot,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: "test",
      SESSION_SECRET: "lms-user-group-test-session-secret",
      ADMIN_USERNAME: "lms-test-admin",
      ADMIN_PASSWORD: "lms-test-password",
    },
    stdio: "ignore",
  });
  const serverExit = once(serverProcess, "exit");
  const baseUrl = `http://127.0.0.1:${port}/api`;

  t.after(async () => {
    if (serverProcess.exitCode === null) serverProcess.kill();
    await serverExit;
  });

  const user = await waitForRoster(baseUrl);
  const targetGroup = user.group === "All Content" ? "Engineering" : "All Content";

  const unauthenticated = await fetch(`${baseUrl}/users/${user.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ group: targetGroup }),
  });
  assert.equal(unauthenticated.status, 401);

  const login = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "lms-test-admin", password: "lms-test-password" }),
  });
  assert.equal(login.status, 200);
  const sessionCookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(sessionCookie, "admin login should issue a session cookie");

  const groupCatalog = await fetch(`${baseUrl}/curriculum/groups`);
  assert.equal(groupCatalog.status, 200);
  const existingGroups = await groupCatalog.json() as Array<{ id: string; name: string }>;
  let temporaryGroupId: string | null = null;
  if (!existingGroups.some((group) => group.name === user.group)) {
    const createdGroup = await fetch(`${baseUrl}/curriculum/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ name: user.group }),
    });
    assert.equal(createdGroup.status, 201);
    temporaryGroupId = (await createdGroup.json() as { id: string }).id;
  }

  try {
    const updated = await fetch(`${baseUrl}/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ group: targetGroup }),
    });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).group, targetGroup);
  } finally {
    const restored = await fetch(`${baseUrl}/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ group: user.group }),
    });
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).group, user.group);
    if (temporaryGroupId) {
      const deletedGroup = await fetch(`${baseUrl}/curriculum/groups/${temporaryGroupId}`, {
        method: "DELETE",
        headers: { Cookie: sessionCookie },
      });
      assert.equal(deletedGroup.status, 200);
    }
  }
});
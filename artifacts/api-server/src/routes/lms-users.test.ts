import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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

async function waitForServer(baseUrl: string) {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/auth/status`);
      if (response.ok) return;
    } catch {
      // The test server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test server did not become available");
}

test("admin user workspace is authorized, persistent, and duplicate-safe", async (t) => {
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
      CLERK_SECRET_KEY: "sk_test_aW52YWxpZC5jbGVyay5hY2NvdW50cy5kZXYk",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let serverErrorOutput = "";
  serverProcess.stderr?.on("data", (chunk) => { serverErrorOutput += String(chunk); });
  serverProcess.on("exit", (code) => {
    if (code && code !== 0) console.error(serverErrorOutput);
  });
  const serverExit = once(serverProcess, "exit");
  const baseUrl = `http://127.0.0.1:${port}/api`;

  t.after(async () => {
    if (serverProcess.exitCode === null) serverProcess.kill();
    await serverExit;
  });

  await waitForServer(baseUrl);

  const unauthorizedDirectory = await fetch(`${baseUrl}/users`);
  assert.equal(unauthorizedDirectory.status, 401);
  const unauthorizedImport = await fetch(`${baseUrl}/users/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: "unauthorized.csv", rows: [{ name: "Blocked", email: "blocked@example.invalid" }] }),
  });
  assert.equal(unauthorizedImport.status, 401);
  const unauthorizedGroup = await fetch(`${baseUrl}/curriculum/groups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Blocked group" }),
  });
  assert.equal(unauthorizedGroup.status, 401);
  const unauthorizedEnrollment = await fetch(`${baseUrl}/users/missing/enrollments`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ courseIds: [] }),
  });
  assert.equal(unauthorizedEnrollment.status, 401);

  const login = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "lms-test-admin", password: "lms-test-password" }),
  });
  assert.equal(login.status, 200);
  const sessionCookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(sessionCookie, "admin login should issue a session cookie");

  const suffix = randomUUID();
  const email = `workspace-${suffix}@example.invalid`;
  const group = `Workspace test ${suffix}`;
  const filename = `workspace-${suffix}.csv`;
  let importedUserId: string | null = null;
  let legacyUserId: string | null = null;
  let temporaryGroupId: string | null = null;

  try {
    const firstImport = await fetch(`${baseUrl}/users/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({
        filename,
        rows: [{ name: "Workspace Faculty", email, role: "Faculty", group, status: "Active" }],
      }),
    });
    assert.equal(firstImport.status, 201);
    const firstResult = await firstImport.json() as { id: string; added: number; updated: number };
    assert.equal(firstResult.added, 1);
    assert.equal(firstResult.updated, 0);

    const pendingDirectory = await fetch(
      `${baseUrl}/users?search=${encodeURIComponent(email)}&status=Pending`,
      { headers: { Cookie: sessionCookie } },
    );
    assert.equal(pendingDirectory.status, 200);
    assert.equal((await pendingDirectory.json() as Array<unknown>).length, 1);

    const failedInvitations = await fetch(`${baseUrl}/users/invite-pending`, {
      method: "POST",
      headers: { Cookie: sessionCookie },
    });
    assert.equal(failedInvitations.status, 200);
    const failedInvitationResult = await failedInvitations.json() as { failed: number };
    assert.ok(failedInvitationResult.failed >= 1, "a Clerk failure should be reported without activating the user");
    const stillPending = await fetch(
      `${baseUrl}/users?search=${encodeURIComponent(email)}&status=Pending`,
      { headers: { Cookie: sessionCookie } },
    );
    assert.equal((await stillPending.json() as Array<unknown>).length, 1);

    const failedCreateEmail = `failed-create-${suffix}@example.invalid`;
    const failedCreate = await fetch(`${baseUrl}/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ name: "Failed Clerk Create", email: failedCreateEmail, role: "Learner", group }),
    });
    assert.equal(failedCreate.status, 502);
    const failedCreateLookup = await fetch(
      `${baseUrl}/users?search=${encodeURIComponent(failedCreateEmail)}`,
      { headers: { Cookie: sessionCookie } },
    );
    assert.deepEqual(await failedCreateLookup.json(), [], "failed Clerk provisioning must not create a directory row");

    const secondImport = await fetch(`${baseUrl}/users/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({
        filename,
        rows: [{ name: "Workspace Learner", email: email.toUpperCase(), role: "Learner", group, status: "Suspended" }],
      }),
    });
    assert.equal(secondImport.status, 201);
    const secondResult = await secondImport.json() as { id: string; added: number; updated: number };
    assert.equal(secondResult.added, 0);
    assert.equal(secondResult.updated, 1);

    const filteredDirectory = await fetch(
      `${baseUrl}/users?search=${encodeURIComponent(email)}&role=Learner&group=${encodeURIComponent(group)}&status=Suspended`,
      { headers: { Cookie: sessionCookie } },
    );
    assert.equal(filteredDirectory.status, 200);
    const matches = await filteredDirectory.json() as Array<{ id: string; name: string; email: string; role: string; groupId: string | null; group: string; status: string }>;
    assert.equal(matches.length, 1, "case-insensitive re-import must update rather than duplicate");
    assert.equal(matches[0].name, "Workspace Learner");
    assert.ok(matches[0].groupId, "an imported membership should reference its durable group");
    importedUserId = matches[0].id;

    const groupsAfterImport = await fetch(`${baseUrl}/curriculum/groups`);
    assert.equal(groupsAfterImport.status, 200);
    const importedGroups = await groupsAfterImport.json() as Array<{ id: string; name: string; learnerCount: number }>;
    const importedGroup = importedGroups.find((row) => row.name === group);
    const allContent = importedGroups.find((row) => row.name === "All Content");
    assert.ok(importedGroup, "import should create a matching group record");
    assert.equal(importedGroup.learnerCount, 1, "the imported learner should count against its imported group");
    assert.ok(allContent, "seeded groups without imported learners should remain available");
    const allContentLearnersBeforeMove = allContent.learnerCount;

    legacyUserId = `u-legacy-${randomUUID()}`;
    const legacyEmail = `legacy-${suffix}@example.invalid`;
    const createLegacyUser = spawnSync(
      "psql",
      [process.env.DATABASE_URL ?? ""],
      {
        input: `INSERT INTO users (id, name, email, role, group_name, status, last_activity) VALUES ('${legacyUserId}', 'Legacy Learner', '${legacyEmail}', 'student', '${group}', 'Active', 'Never');`,
        encoding: "utf8",
      },
    );
    assert.equal(createLegacyUser.status, 0, createLegacyUser.stderr);

    const deletedImportedGroup = await fetch(`${baseUrl}/curriculum/groups/${importedGroup.id}`, {
      method: "DELETE",
      headers: { Cookie: sessionCookie },
    });
    assert.equal(deletedImportedGroup.status, 200);
    const recreatedGroupResponse = await fetch(`${baseUrl}/curriculum/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ name: group.toLowerCase() }),
    });
    assert.equal(recreatedGroupResponse.status, 201);
    const recreatedGroup = await recreatedGroupResponse.json() as { id: string; name: string };
    temporaryGroupId = recreatedGroup.id;

    const groupsAfterRecreate = await fetch(`${baseUrl}/curriculum/groups`);
    assert.equal(groupsAfterRecreate.status, 200);
    const recreatedGroups = await groupsAfterRecreate.json() as Array<{ id: string; name: string; learnerCount: number }>;
    assert.equal(
      recreatedGroups.find((row) => row.id === recreatedGroup.id)?.learnerCount,
      0,
      "deleting and recreating a group must not reassign its former learners by name",
    );
    const legacyDirectory = await fetch(`${baseUrl}/users?search=${encodeURIComponent(legacyEmail)}`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(legacyDirectory.status, 200);
    assert.deepEqual(
      (await legacyDirectory.json() as Array<{ groupId: string | null; group: string }>).map(({ groupId, group: groupName }) => ({ groupId, groupName })),
      [{ groupId: null, groupName: "" }],
      "deleting a group must clear legacy name-only memberships as well",
    );

    const updated = await fetch(`${baseUrl}/users/${importedUserId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ name: "Workspace Learner Updated", role: "Learner", status: "Active", groupId: allContent.id }),
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(
      (({ name, role, status, group: groupName }) => ({ name, role, status, group: groupName }))(await updated.json()),
      { name: "Workspace Learner Updated", role: "Learner", status: "Active", group: "All Content" },
    );

    const reread = await fetch(`${baseUrl}/users?search=${encodeURIComponent(email)}`, { headers: { Cookie: sessionCookie } });
    assert.equal(reread.status, 200);
    const persisted = await reread.json() as Array<{ id: string; role: string; status: string }>;
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].role, "Learner");
    assert.equal(persisted[0].status, "Active");

    const groupsAfterMove = await fetch(`${baseUrl}/curriculum/groups`);
    assert.equal(groupsAfterMove.status, 200);
    const movedGroups = await groupsAfterMove.json() as Array<{ id: string; name: string; learnerCount: number }>;
    assert.equal(
      movedGroups.find((row) => row.id === recreatedGroup.id)?.learnerCount,
      0,
      "a manual group change should remove the learner from their old group after a reload",
    );
    assert.equal(
      movedGroups.find((row) => row.id === allContent.id)?.learnerCount,
      allContentLearnersBeforeMove + 1,
      "a manual group change should count the learner in their new group",
    );

    const coursesResponse = await fetch(`${baseUrl}/curriculum/list`);
    assert.equal(coursesResponse.status, 200);
    const courses = await coursesResponse.json() as Array<{ id: string }>;
    assert.ok(courses.length > 0, "seeded curriculum should contain courses");
    const selectedCourseIds = courses.slice(0, 2).map((course) => course.id);
    const enrollmentUpdate = await fetch(`${baseUrl}/users/${importedUserId}/enrollments`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ courseIds: selectedCourseIds }),
    });
    assert.equal(enrollmentUpdate.status, 200);

    const enrollments = await fetch(`${baseUrl}/users/${importedUserId}/enrollments`, { headers: { Cookie: sessionCookie } });
    assert.equal(enrollments.status, 200);
    assert.deepEqual(
      (await enrollments.json() as Array<{ courseId: string }>).map((row) => row.courseId).sort(),
      [...selectedCourseIds].sort(),
    );

    const audits = await fetch(`${baseUrl}/users/imports`, { headers: { Cookie: sessionCookie } });
    assert.equal(audits.status, 200);
    const auditRows = await audits.json() as Array<{ id: string; filename: string }>;
    assert.ok(auditRows.some((row) => row.id === firstResult.id && row.filename === filename));
    assert.ok(auditRows.some((row) => row.id === secondResult.id && row.filename === filename));

    const groupCatalog = await fetch(`${baseUrl}/curriculum/groups`);
    assert.equal(groupCatalog.status, 200);
    const existingGroups = await groupCatalog.json() as Array<{ id: string; name: string }>;
    assert.ok(temporaryGroupId, "import should create its missing group");
  } finally {
    if (importedUserId || legacyUserId || temporaryGroupId) {
      if (importedUserId && !/^u-import-[0-9a-f-]+$/.test(importedUserId)) throw new Error("Unexpected test user ID");
      if (legacyUserId && !/^u-legacy-[0-9a-f-]+$/.test(legacyUserId)) throw new Error("Unexpected legacy test user ID");
      if (temporaryGroupId && !/^g-(?:import-[0-9a-f-]+|[0-9]+)$/.test(temporaryGroupId)) throw new Error("Unexpected test group ID");
      const cleanupSql = [
        importedUserId ? `DELETE FROM users WHERE id = '${importedUserId}';` : "",
        legacyUserId ? `DELETE FROM users WHERE id = '${legacyUserId}';` : "",
        temporaryGroupId ? `DELETE FROM groups WHERE id = '${temporaryGroupId}';` : "",
      ].filter(Boolean).join("\n");
      const cleanup = spawnSync("psql", [process.env.DATABASE_URL ?? ""], { input: cleanupSql, encoding: "utf8" });
      assert.equal(cleanup.status, 0, cleanup.stderr);
    }
  }
});
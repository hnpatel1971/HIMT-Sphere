import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const dbDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceDirectory = resolve(dbDirectory, "../..");
const destructiveOutput = /\b(?:drop|truncate(?:\s+table)?|delete\s+from|data\s+loss|destructive|will\s+be\s+deleted)\b/i;

function command(commandName, args, options = {}) {
  const { cwd = workspaceDirectory, env = process.env, timeoutMs = 120_000 } = options;

  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(commandName, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      rejectCommand(error);
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolveCommand({ exitCode, signal, stdout, stderr, timedOut });
    });
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolveClose) => server.close(resolveClose));
  if (!port) throw new Error("Could not allocate a local PostgreSQL port");
  return port;
}

function outputFor(result) {
  return `${result.stdout}\n${result.stderr}`;
}

function requireSuccessfulCommand(name, result) {
  if (result.timedOut || result.exitCode !== 0) {
    throw new Error(`${name} failed (exit ${result.exitCode ?? "unknown"}):\n${outputFor(result)}`);
  }
}

function requireSafePush(name, result, expectedMarker) {
  const output = outputFor(result);
  if (result.timedOut) {
    throw new Error(`${name} timed out:\n${output}`);
  }
  if (destructiveOutput.test(output)) {
    throw new Error(`${name} reported a destructive database change:\n${output}`);
  }
  if (/interactive prompts require a tty|prompt.*(?:data|schema|table)/i.test(output)) {
    throw new Error(`${name} prompted for manual approval instead of applying a safe additive change:\n${output}`);
  }
  if (result.exitCode !== 0) {
    throw new Error(`${name} failed (exit ${result.exitCode}):\n${output}`);
  }
  if (!output.includes(expectedMarker)) {
    throw new Error(`${name} did not report "${expectedMarker}". Drizzle may have prompted for an unsafe change:\n${output}`);
  }
}

async function verifyFixtureData(databaseUrl, stage) {
  const sentinelQuery = `
    SELECT
      (SELECT count(*) FROM user_sessions WHERE sid = 'schema-push-sentinel') AS session_rows,
      (SELECT count(*) FROM groups WHERE id = 'schema-push-sentinel') AS application_rows;
  `;
  const sentinelResult = await command("psql", [databaseUrl, "-At", "-v", "ON_ERROR_STOP=1", "-c", sentinelQuery]);
  requireSuccessfulCommand(`${stage} sentinel verification`, sentinelResult);
  if (sentinelResult.stdout.trim() !== "1|1") {
    throw new Error(`${stage} schema push did not preserve fixture data:\n${outputFor(sentinelResult)}`);
  }
}

async function stopPostgres(dataDirectory) {
  const stopResult = await command(
    "pg_ctl",
    ["-D", dataDirectory, "-m", "immediate", "-w", "stop"],
    { timeoutMs: 30_000 },
  );
  if (stopResult.exitCode === 0 && !stopResult.timedOut) return;

  let forcedTermination = "";
  try {
    const pid = Number((await readFile(join(dataDirectory, "postmaster.pid"), "utf8")).split("\n", 1)[0]);
    if (Number.isInteger(pid) && pid > 0) {
      process.kill(pid, "SIGKILL");
      forcedTermination = ` Forced termination was requested for PostgreSQL process ${pid}.`;
    }
  } catch {
    // If the PID file is gone, PostgreSQL may already have stopped despite pg_ctl's exit status.
  }

  const statusResult = await command("pg_ctl", ["-D", dataDirectory, "status"], { timeoutMs: 30_000 });
  if (statusResult.exitCode !== 0) return;

  throw new Error(`Could not stop temporary PostgreSQL fixture:${forcedTermination}\n${outputFor(stopResult)}\n${outputFor(statusResult)}`);
}

async function main() {
  let fixtureDirectory;
  let dataDirectory;
  let serverStarted = false;

  try {
    fixtureDirectory = await mkdtemp(join(tmpdir(), "himt-schema-push-"));
    dataDirectory = join(fixtureDirectory, "data");
    const socketDirectory = join(fixtureDirectory, "socket");
    const logPath = join(fixtureDirectory, "postgres.log");
    const port = await freePort();
    const databaseName = "schema_push_fixture";
    const databaseUrl = `postgresql://postgres@127.0.0.1:${port}/${databaseName}`;
    const fixtureEnvironment = { ...process.env, DATABASE_URL: databaseUrl };

    await mkdir(socketDirectory);
    requireSuccessfulCommand(
      "initdb",
      await command("initdb", ["-D", dataDirectory, "--no-locale", "--encoding=UTF8", "-U", "postgres", "--auth=trust"]),
    );
    requireSuccessfulCommand(
      "pg_ctl start",
      await command("pg_ctl", [
        "-D",
        dataDirectory,
        "-o",
        `-p ${port} -h 127.0.0.1 -k ${socketDirectory}`,
        "-l",
        logPath,
        "-w",
        "start",
      ]),
    );
    serverStarted = true;
    requireSuccessfulCommand(
      "createdb",
      await command("createdb", ["-h", "127.0.0.1", "-p", String(port), "-U", "postgres", databaseName]),
    );

    const fixtureSql = `
      CREATE TABLE user_sessions (
        sid varchar NOT NULL PRIMARY KEY,
        sess json NOT NULL,
        expire timestamp(6) NOT NULL
      );
      CREATE TABLE groups (
        id text PRIMARY KEY,
        name text NOT NULL,
        parent_id text,
        created_at timestamp DEFAULT now() NOT NULL
      );
      CREATE UNIQUE INDEX groups_name_lower_unique ON groups (lower(name));
      INSERT INTO user_sessions (sid, sess, expire)
      VALUES ('schema-push-sentinel', '{}', now() + interval '1 hour');
      INSERT INTO groups (id, name)
      VALUES ('schema-push-sentinel', 'Schema Push Sentinel');
    `;
    requireSuccessfulCommand(
      "session fixture",
      await command("psql", [databaseUrl, "-v", "ON_ERROR_STOP=1", "-c", fixtureSql]),
    );

    // Do not pass --force: the test must fail instead of approving data loss.
    const firstPush = await command("pnpm", ["--filter", "@workspace/db", "run", "push"], {
      env: fixtureEnvironment,
    });
    requireSafePush("first schema push", firstPush, "Changes applied");
    await verifyFixtureData(databaseUrl, "first");

    const secondPush = await command("pnpm", ["--filter", "@workspace/db", "run", "push"], {
      env: fixtureEnvironment,
    });
    requireSafePush("second schema push", secondPush, "No changes detected");
    await verifyFixtureData(databaseUrl, "second");

    console.log("Schema push regression passed: additive first push, no-op second push, and sentinel data preserved.");
  } finally {
    try {
      if (serverStarted && dataDirectory) await stopPostgres(dataDirectory);
    } finally {
      if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});